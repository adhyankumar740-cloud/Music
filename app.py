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
RENDER_EXTERNAL_URL: Optional[str] = os.getenv("RENDER_EXTERNAL_URL") # Your Backend URL
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
        await initialize_ptb_application() 
        if not application:
            return 'Bot not ready', 503

    if request.method == "POST":
        try:
            request_data = request.get_json(force=True) 
            update = Update.de_json(request_data, application.bot) 
            await application.process_update(update) 
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
# --- 4.5. TRACK POSTING ENDPOINT (Background Play Fix) ---
# ------------------------------------------------------------------

async def _send_track_message(chat_id, video_id, title):
    """
    Internal function to send a Telegram message with the YouTube link.
    This enables Telegram's native background player.
    """
    if not application:
        await initialize_ptb_application()
    if not application:
        return False

    youtube_url = f"https://www.youtube.com/watch?v={video_id}"
    
    # FIX: Using HTML parse mode for reliable link preview and easier formatting
    message = f'🎶 <b>Now Playing in Group:</b>\n<a href="{youtube_url}">{title}</a>'
    
    try:
        # Use send_message with parse_mode='HTML'
        await application.bot.send_message(
            chat_id=chat_id, 
            text=message, 
            parse_mode='HTML', 
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("Open Search Again", url=RENDER_FRONTEND_URL)
            ]])
        )
        return True
    except Exception as e:
        logger.error(f"Failed to send track message to chat {chat_id}: {e}")
        return False

@app.route('/post-track-to-chat', methods=['POST'])
async def post_track_to_chat():
    """
    Accepts track info from the Web App and posts it to the group chat.
    """
    try:
        data = request.get_json()
        chat_id = data.get('chat_id')
        video_id = data.get('video_id')
        title = data.get('title')

        if not all([chat_id, video_id, title]):
            return jsonify({'error': 'Missing chat_id, video_id, or title'}), 400

        success = await _send_track_message(chat_id, video_id, title)

        if success:
            return jsonify({'status': 'success', 'message': 'Track posted to chat for playback.'}), 200
        else:
            return jsonify({'status': 'error', 'message': 'Failed to post track to Telegram.'}), 500

    except Exception as e:
        logger.error(f"Error in post-track-to-chat: {e}")
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
# --- 6. ASGI WRAPPER ---
# ------------------------------------------------------------------

# Flask (WSGI) app को Uvicorn (ASGI) के साथ compatible बनाने के लिए wrap करें।
flask_asgi_app = WsgiToAsgi(app) 

async def application_asgi(scope, receive, send):
    """Custom ASGI application wrapper."""
    if scope['type'] in ['http', 'lifespan']:
        await flask_asgi_app(scope, receive, send)
    elif scope['type'] == 'websocket':
        # WebSockets are ignored as Flask does not natively support them
        logger.warning(f"Ignored non-HTTP scope type: {scope['type']}")
        pass 
    else:
        await flask_asgi_app(scope, receive, send)

asgi_app = application_asgi 

if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 8000))
    logger.warning("Running with Flask built-in server (Local Only). Use Uvicorn for production.")
    app.run(host='0.0.0.0', port=PORT, debug=True)
