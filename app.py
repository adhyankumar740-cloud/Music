import os
import logging
import threading
from typing import Optional

# --- EVENTLET INTEGRATION ---
try:
    import eventlet
    # Patch Python's blocking I/O functions to non-blocking I/O
    eventlet.monkey_patch() 
    ASYNC_MODE = 'eventlet'
except ImportError:
    # If eventlet is not used, the Polling part must run in a thread
    ASYNC_MODE = 'threading'
    print("Warning: eventlet not installed. Using threading mode.")
# ----------------------------

# We remove 'httpx' and 'asyncio' imports as they are mostly used for Webhook/PTB async calls
from flask import Flask, request, jsonify, abort 
from flask_socketio import SocketIO, join_room, emit
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler, filters, 
    ContextTypes, Application
)
from dotenv import load_dotenv

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
YOUTUBE_API_KEY: Optional[str] = os.getenv("YOUTUBE_API_KEY") 

# --- Global Objects ---
app = Flask(__name__)
# Flask-SocketIO initialization (CORS configured for any origin)
socketio = SocketIO(app, async_mode=ASYNC_MODE, cors_allowed_origins="*", logger=True, engineio_logger=True)

application: Optional[Application] = None
bot_thread: Optional[threading.Thread] = None

# ------------------------------------------------------------------
# --- BOT HANDLERS ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Welcome! Type `/play` to start the group music player.")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL is not set.')
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
    await update.message.reply_text("I am programmed to play music only. Please use `/play`.")

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.error("Exception while handling an update:", exc_info=context.error)

def setup_handlers(app_ptb: Application):
    logger.info("Setting up Music Bot handlers...")
    app_ptb.add_handler(CommandHandler("start", start_command))
    app_ptb.add_handler(CommandHandler("play", play_command))
    app_ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_messages))
    app_ptb.add_error_handler(error_handler)
    logger.info("All handlers set up.")

# ------------------------------------------------------------------
# --- PTB Initialization for POLLING ---
# ------------------------------------------------------------------

def start_bot_polling():
    global application
    
    if not TELEGRAM_BOT_TOKEN: 
        logger.critical("CRITICAL: TELEGRAM_BOT_TOKEN is missing!")
        return

    # Use a simpler application builder suitable for polling
    app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    application = app_builder.build()
    setup_handlers(application)
    
    # Run the bot in polling mode (synchronous call - this is why we thread it)
    logger.info("Starting Telegram Bot in POLLING mode...")
    
    # We must ensure to delete any old webhooks if we switch to polling
    try:
        application.bot.set_webhook(url='')
        logger.info("Old webhook deleted successfully.")
    except Exception as e:
        logger.warning(f"Could not delete old webhook: {e}")

    try:
        application.run_polling()
    except Exception as e:
        logger.critical(f"FATAL ERROR during PTB Polling: {e}", exc_info=True)


# ------------------------------------------------------------------
# --- YOUTUBE DATA API SEARCH ENDPOINT ---
# ------------------------------------------------------------------

# NOTE: Since we removed 'httpx' import, you must add it back to your requirements.txt
# If the code above is run in an eventlet environment, 'requests' or 'httpx' 
# calls will be non-blocking due to monkey_patch().
import requests 

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
        # Using requests now (it's synchronous but non-blocking thanks to eventlet.monkey_patch())
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
        
    except requests.exceptions.HTTPError as e: 
        logger.error(f"YouTube API Error: {e}", exc_info=True)
        return jsonify({'error': f'Failed to search YouTube: {e}'}), 500
    except requests.exceptions.RequestException as e:
        logger.error(f"Network Error: {e}", exc_info=True)
        return jsonify({'error': 'Network error while fetching YouTube data.'}), 500


# ------------------------------------------------------------------
# --- SOCKETIO (REAL-TIME GROUP LISENING) HANDLERS ---
# ------------------------------------------------------------------

@socketio.on('join_group')
def handle_join_group(data):
    chat_id = data.get('chat_id')
    if chat_id:
        join_room(str(chat_id))
        logger.info(f"Client joined room: {chat_id}")
        emit('status_message', {'message': 'New member joined. Syncing...'}, room=str(chat_id))
    else:
        logger.warning("Client tried to join group without chat_id.")

@socketio.on('control_stream')
def handle_control_stream(data):
    chat_id = data.get('chat_id')
    action = data.get('action') 
    time = data.get('time', 0) 
    
    if chat_id and action:
        room_id = str(chat_id)
        logger.info(f"Control from {request.sid} in {room_id}: {action} at {time}s")
        
        emit('sync_control', 
             {'action': action, 'time': time, 'video_id': data.get('video_id')}, 
             room=room_id, 
             skip_sid=request.sid 
        )
    else:
        logger.warning(f"Control stream received missing chat_id ({chat_id}) or action ({action})")

# --- Health Check and CORS Fix (Required by Flask/Render) ---

@app.after_request
def after_request(response):
    """Manually sets CORS headers to resolve 'Failed to fetch' issues."""
    header = response.headers
    header['Access-Control-Allow-Origin'] = '*'
    header['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    header['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

@app.route('/')
def health_check():
    """Simple health check for Render."""
    return "Music Bot Backend is alive and ready for sync and search!", 200

# ------------------------------------------------------------------
# --- MAIN RUN ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    # Start the PTB bot in a separate thread so it doesn't block Flask/SocketIO
    bot_thread = threading.Thread(target=start_bot_polling, daemon=True)
    bot_thread.start()
    
    PORT = int(os.environ.get('PORT', 8000))
    
    logger.info(f"Starting server in {ASYNC_MODE} mode on port {PORT}...")
    # Use standard Flask-SocketIO run
    socketio.run(app, host='0.0.0.0', port=PORT, debug=False)
