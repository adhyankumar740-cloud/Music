import os
import logging
import asyncio 
from typing import Optional

# Flask is used for routing (ASGI compatibility needed)
from flask import Flask, request, jsonify, abort 
# New Import: CORS is needed for the Web App to communicate with the search API
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
RENDER_FRONTEND_URL: Optional[str] = os.getenv('RENDER_FRONTEND_URL') 
RENDER_EXTERNAL_URL: Optional[str] = os.getenv("RENDER_EXTERNAL_URL") 
YOUTUBE_API_KEY: Optional[str] = os.getenv("YOUTUBE_API_KEY") 

WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' if TELEGRAM_BOT_TOKEN else '/webhook/dummy_token'

# --- Global Objects ---
app = Flask(__name__)
# FIX: Enable CORS for all origins and methods
CORS(app) 
application: Optional[Application] = None

# ------------------------------------------------------------------
# --- 1. BOT HANDLERS (Async) ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /start command."""
    # Using effective_message for compatibility
    await update.effective_message.reply_text("Welcome! Type `/play` to start the group music player.")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /play command and sends the Web App link."""
    # FIX 1: Ensure effective_message exists for group compatibility
    if not update.effective_message:
        return 

    if not RENDER_FRONTEND_URL:
        await update.effective_message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    chat_id = update.effective_chat.id
    player_url = f"{RENDER_FRONTEND_URL}?chat_id={chat_id}&mode=search"
    
    web_app_info = WebAppInfo(url=player_url)
    
    keyboard = [[
        InlineKeyboardButton(
            "▶️ Search and Play Group Music", 
            web_app=web_app_info 
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    # Use effective_message to reply correctly in group chats
    await update.effective_message.reply_text(
        'Open the player to search and sync music with your group:', 
        reply_markup=reply_markup
    )

async def handle_text_messages(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Responds to non-command text messages."""
    # FIX 2: Only reply to non-command text messages in Private Chats (DMs) 
    # to prevent spamming in Group Chats.
    if update.effective_chat.type == 'private':
        await update.message.reply_text("I am programmed to play music only. Please use `/play`.")
    # If it's a group, we do nothing for non-command text messages.

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Logs errors caused by Updates."""
    logger.error("Exception while handling an update:", exc_info=context.error)

def setup_handlers(app_ptb: Application):
    """Registers all command and message handlers."""
    logger.info("Setting up Music Bot handlers...")
    app_ptb.add_handler(CommandHandler("start", start_command))
    app_ptb.add_handler(CommandHandler("play", play_command))
    # Note: filters.COMMAND is important here to ensure only non-command text is handled
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
    
    # We don't call application.start() here in a webhook environment, 
    # but application.initialize() is crucial.

# ------------------------------------------------------------------
# --- 3. WEBHOOK ENDPOINT (Async) ---
# ------------------------------------------------------------------

@app.route(WEBHOOK_PATH, methods=['POST'])
async def telegram_webhook(): 
    """Handles incoming Telegram updates and passes them to PTB."""
    # Ensure application is initialized before processing updates
    if not application:
        await initialize_ptb_application() 
        if not application:
            return 'Bot not ready', 503

    if request.method == "POST":
        try:
            # request.get_json() is synchronous in Flask
            request_data = request.get_json(force=True) 
            update = Update.de_json(request_data, application.bot) 
            # Process update in the event loop
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
# --- 5. SERVER STARTUP & HEALTH CHECK ---
# ------------------------------------------------------------------

@app.route('/')
async def health_check():
    """Simple health check and attempts to initialize the bot if needed."""
    if not application:
        await initialize_ptb_application() 
    return "Music Bot Backend is alive and ready!", 200

# ------------------------------------------------------------------
# --- 6. ASGI WRAPPER (CRITICAL FIXES) ---
# ------------------------------------------------------------------

# Flask (WSGI) app को Uvicorn (ASGI) के साथ compatible बनाने के लिए wrap करें।
flask_asgi_app = WsgiToAsgi(app) 

# FIX: Custom ASGI application wrapper to filter out non-HTTP scopes (WebSockets)
async def application_asgi(scope, receive, send):
    """
    A custom ASGI application wrapper to filter out non-HTTP scopes 
    that the WsgiToAsgi adapter cannot handle (specifically 'websocket' scopes).
    """
    if scope['type'] in ['http', 'lifespan']:
        await flask_asgi_app(scope, receive, send)
    elif scope['type'] == 'websocket':
        logger.warning(f"Ignored non-HTTP scope type: {scope['type']}")
        pass 
    else:
        await flask_asgi_app(scope, receive, send)

# Uvicorn will load this custom wrapper: app:application_asgi
asgi_app = application_asgi 

# ------------------------------------------------------------------
# --- 7. LOCAL DEVELOPMENT ONLY ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    # For local development/testing only
    PORT = int(os.environ.get('PORT', 8000))
    logger.warning("Running with Flask built-in server (Local Only). Use Uvicorn for production.")
    app.run(host='0.0.0.0', port=PORT, debug=True)
