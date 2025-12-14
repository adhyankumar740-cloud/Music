import os
import logging
import asyncio 
from typing import Optional

# Flask is used for routing (ASGI compatibility needed)
from flask import Flask, request, jsonify, abort 
from flask_cors import CORS 
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler, filters, 
    ContextTypes, Application
)
from dotenv import load_dotenv
import requests 
from asgiref.wsgi import WsgiToAsgi 

# Load environment variables
load_dotenv()

# --- Logging Setup ---
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# --- Configuration (Environment Variables) ---
TELEGRAM_BOT_TOKEN: Optional[str] = os.getenv("TELEGRAM_BOT_TOKEN")
RENDER_FRONTEND_URL: Optional[str] = os.getenv('RENDER_FRONTEND_URL') # Your Mini App URL
RENDER_EXTERNAL_URL: Optional[str] = os.getenv("RENDER_EXTERNAL_URL") # Your Backend URL (e.g., https://your-name.onrender.com)
YOUTUBE_API_KEY: Optional[str] = os.getenv("YOUTUBE_API_KEY") 

WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' if TELEGRAM_BOT_TOKEN else '/webhook/dummy_token'

# --- Global Objects ---
app = Flask(__name__)
CORS(app) 
application: Optional[Application] = None

# ------------------------------------------------------------------
# --- 1. BOT HANDLERS (Async) ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /start command."""
    await update.effective_message.reply_text("Welcome! Type `/play` to start the group music player.")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /play command and sends the Web App link."""
    if not update.effective_message:
        return 

    if not RENDER_FRONTEND_URL:
        await update.effective_message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    chat_id = update.effective_chat.id
    # Mini App URL for search interface, passing chat_id
    player_url = f"{RENDER_FRONTEND_URL}?chat_id={chat_id}"
    
    web_app_info = WebAppInfo(url=player_url)
    
    keyboard = [[
        InlineKeyboardButton(
            "▶️ Open Music Search", 
            web_app=web_app_info 
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    # FIX: Using context.bot.send_message to prevent Button_type_invalid error in groups
    await context.bot.send_message(
        chat_id=chat_id,
        text='Open the player to search and post a track for group playback:', 
        reply_markup=reply_markup
    )

async def handle_text_messages(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Responds to non-command text messages."""
    # Only reply in Private Chats (DMs) to prevent group spam.
    if update.effective_chat.type == 'private':
        await update.message.reply_text("I am programmed to play music only. Please use `/play`.")
        
async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Logs errors caused by Updates."""
    logger.error("Exception while handling an update:", exc_info=context.error)

def setup_handlers(app_ptb: Application):
    """Registers all command and message handlers."""
    logger.info("Setting up Music Bot handlers...")
    app_ptb.add_handler(CommandHandler("start", start_command))
    app_ptb.add_handler(CommandHandler("play", play_command))
    app_ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_messages))
    app_ptb.add_error_handler(error_handler)
    logger.info("All handlers set up.")

# ------------------------------------------------------------------
# --- 2. PTB INITIALIZATION (Async) ---
# ------------------------------------------------------------------

async def initialize_ptb_application():
    """Initializes the PTB Application, registers handlers, and sets the webhook."""
    global application
    if application: return
    
    if not TELEGRAM_BOT_TOKEN or not RENDER_EXTERNAL_URL: 
        logger.critical("CRITICAL: TOKEN or URL is missing! Cannot initialize bot.")
        return

    app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    application = app_builder.build()
    setup_handlers(application)
    
    webhook_url = f'{RENDER_EXTERNAL_URL}{WEBHOOK_PATH}'
    await application.initialize() 
    
    # Check current bot info (useful for logging)
    try:
        bot_info = await application.bot.get_me()
        logger.info(f"Bot Identity: {bot_info.username}")
    except Exception as e:
        logger.error(f"Could not get bot info: {e}")

    # Set Webhook
    success = await application.bot.set_webhook(url=webhook_url)
    if success:
        logger.info(f"Auto-Webhook successfully set to {webhook_url}")
    else:
        logger.error("Auto-Webhook setting failed.")

# ------------------------------------------------------------------
# --- 3. WEBHOOK ENDPOINT (Async) ---
# ------------------------------------------------------------------

@app.route(WEBHOOK_PATH, methods=['POST'])
async def telegram_webhook(): 
    """Handles incoming Telegram updates and passes them to PTB."""
    if not application:
        # Attempt initialization if not ready (important for Render startup)
        await initialize_ptb_application() 
        if not application:
            return 'Bot not ready', 503

    if request.method == "POST":
        try:
            request_data = request.get_json(force=True) 
            update = Update.de_json(request_data, application.bot) 
            # Use asyncio.ensure_future or similar to process updates in the background
            asyncio.create_task(application.process_update(update))
            return 'ok' 
        except Exception as e:
            logger.error(f"Error processing update: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Update processing failed'}), 500
    return abort(400)

# ------------------------------------------------------------------
# --- 4. YOUTUBE DATA API SEARCH ENDPOINT (Synchronous) ---
# ------------------------------------------------------------------

@app.route('/search-youtube', methods=['GET'])
def search_youtube():
    """Handles YouTube search queries using the Data API."""
    query = request.args.get('q')
    if not query:
        return jsonify({'error': 'Query parameter "q" is required'}), 400
    if not YOUTUBE_API_KEY:
        return jsonify({'error': 'YOUTUBE_API_KEY is not configured on the server'}), 500

    YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
    params = {
        'part': 'snippet',
        'q': query,
        'key': YOUTUBE_API_KEY,
        'type': 'video',
        'maxResults': 5 
    }
    
    try:
        response = requests.get(YOUTUBE_SEARCH_URL, params=params) 
        response.raise_for_status() 
        data = response.json()
        
        results = []
        for item in data.get('items', []):
            results.append({
                'id': item['id']['videoId'],
                'title': item['snippet']['title'],
                'channel': item['snippet']['channelTitle'],
                'thumbnail': item['snippet']['thumbnails']['default']['url']
            })
            
        return jsonify({'status': 'success', 'results': results})
        
    except requests.exceptions.RequestException as e:
        logger.error(f"YouTube API Error: {e}", exc_info=True)
        return jsonify({'error': f'Failed to search YouTube: {e}'}), 500


# ------------------------------------------------------------------
# --- 4.5. TRACK POSTING ENDPOINT (Group Audio Player FIX) ---
# ------------------------------------------------------------------

async def _send_track_message(chat_id, video_id, title):
    """
    Sends the YouTube URL as streamable media using the Telegram API's 
    sendVideo method (as it's the only one supporting external URLs for background play).
    """
    global application
    if not application:
        await initialize_ptb_application() 
    if not TELEGRAM_BOT_TOKEN or not application:
        logger.error("CRITICAL: Bot not initialized or token missing.")
        return False
        
    youtube_url = f"https://www.youtube.com/watch?v={video_id}"
    
    # Inline keyboard setup
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("Open Search Again", url=RENDER_FRONTEND_URL)
    ]])
    # Encoding the reply markup using the application's utility
    reply_markup_json = application.bot.encode_json(keyboard) 

    # DIRECT TELEGRAM API CALL: Using sendVideo
    TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo"
    
    params = {
        'chat_id': chat_id,
        'video': youtube_url,
        # Using HTML caption and an audio-focused icon
        'caption': f'🎧 <b>Now Playing: {title}</b>',
        'parse_mode': 'HTML',
        'reply_markup': reply_markup_json,
        
        # Parameters to encourage audio-like card (though not guaranteed for YouTube links)
        'supports_streaming': True,
        'width': 1, 
        'height': 1
    }
    
    try:
        # Use requests.post for synchronous HTTP call to the Telegram API
        response = requests.post(TELEGRAM_API_URL, data=params)
        response.raise_for_status() 
        
        response_data = response.json()
        if response_data.get('ok'):
            return True
        else:
            logger.error(f"Telegram API failed to send video: {response_data.get('description', 'Unknown API Error')}")
            return False
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to post track via sendVideo API: {e}")
        return False

@app.route('/post-track-to-chat', methods=['POST'])
async def post_track_to_chat():
    """
    Endpoint called by the Mini App to post the selected track to the group chat.
    """
    try:
        data = request.get_json()
        chat_id = data.get('chat_id')
        video_id = data.get('video_id')
        title = data.get('title')

        if not all([chat_id, video_id, title]):
            return jsonify({'error': 'Missing chat_id, video_id, or title'}), 400

        # We must await the function since it contains the HTTP request
        success = await _send_track_message(chat_id, video_id, title)

        if success:
            return jsonify({'status': 'success', 'message': 'Track posted as streamable media.'}), 200
        else:
            return jsonify({'status': 'error', 'message': 'Failed to post track to Telegram (API call failed).'}), 500

    except Exception as e:
        logger.error(f"Error in post-track-to-chat endpoint: {e}")
        return jsonify({'error': 'Internal Server Error'}), 500


# ------------------------------------------------------------------
# --- 5. SERVER STARTUP & HEALTH CHECK ---
# ------------------------------------------------------------------

@app.route('/')
async def health_check():
    """Simple health check and attempts to initialize the bot if needed."""
    if not application:
        await initialize_ptb_application() 
    return "Music Bot Backend is alive and ready!", 200

# ------------------------------------------------------------------
# --- 6. ASGI WRAPPER (Required for Render Deployment) ---
# ------------------------------------------------------------------

# Flask (WSGI) app को Uvicorn (ASGI) के साथ compatible बनाने के लिए wrap करें।
flask_asgi_app = WsgiToAsgi(app) 

async def application_asgi(scope, receive, send):
    """Custom ASGI application wrapper."""
    if scope['type'] in ['http', 'lifespan']:
        # Ensure initialization runs before handling requests
        await initialize_ptb_application() 
        await flask_asgi_app(scope, receive, send)
    else:
        await flask_asgi_app(scope, receive, send)

asgi_app = application_asgi
