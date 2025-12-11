import os
import logging
import asyncio 
from typing import Optional

# Flask is used for routing
from flask import Flask, request, jsonify, abort 
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler, filters, 
    ContextTypes, Application
)
from dotenv import load_dotenv
import requests 
# New import for ASGI compatibility
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
application: Optional[Application] = None

# ------------------------------------------------------------------
# --- 1. BOT HANDLERS (Async) ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /start command."""
    await update.message.reply_text("Welcome! Type `/play` to start the group music player.")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /play command and sends the Web App link."""
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    chat_id = update.effective_chat.id
    player_url = f"{RENDER_FRONTEND_URL}?chat_id={chat_id}&mode=search"
    
    keyboard = [[
        InlineKeyboardButton(
            "▶️ Search and Play Group Music", 
            web_app={"url": player_url}
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        'Open the player to search and sync music with your group:', 
        reply_markup=reply_markup
    )

async def handle_text_messages(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Responds to non-command text messages."""
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
    
    await application.start() 
    logger.info("PTB Application started successfully.")

# ------------------------------------------------------------------
# --- 3. WEBHOOK ENDPOINT (Async) ---
# ------------------------------------------------------------------

@app.route(WEBHOOK_PATH, methods=['POST'])
async def telegram_webhook(): 
    """Handles incoming Telegram updates and passes them to PTB."""
    if not application:
        # Check and attempt to initialize if the bot wasn't ready during startup
        await initialize_ptb_application() 
        if not application:
             return 'Bot not ready', 503

    if request.method == "POST":
        try:
            # Uvicorn handles async Flask routes
            update = Update.de_json(await request.get_json(force=True), application.bot) 
            await application.process_update(update) # Await PTB function directly
            
            return 'ok' # Required 200 OK response for Telegram
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
        # requests is synchronous, but Uvicorn manages thread blocking
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

# Uvicorn handles startup events, and this ensures initialization runs on the first request
# (or when health_check is hit)

# ------------------------------------------------------------------
# --- 6. ASGI WRAPPER (CRITICAL FIX FOR TYPERROR) ---
# ------------------------------------------------------------------

# Flask (WSGI) app को Uvicorn (ASGI) के साथ compatible बनाने के लिए wrap करें।
# Start command अब 'app:asgi_app' का उपयोग करेगा।
asgi_app = WsgiToAsgi(app)

# ------------------------------------------------------------------
# --- 7. LOCAL DEVELOPMENT ONLY ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    # For local development/testing only
    PORT = int(os.environ.get('PORT', 8000))
    # Note: local run will not handle async routes/initialization correctly without uvicorn
    # But it allows the file to be executed.
    logger.warning("Running with Flask built-in server (Local Only). Use Uvicorn for production.")
    app.run(host='0.0.0.0', port=PORT, debug=True)
