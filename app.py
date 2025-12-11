import os
import logging
import asyncio
import threading 
import httpx 
from typing import Optional

# --- EVENTLET INTEGRATION ---
try:
    import eventlet
    # Patch Python's blocking I/O functions to non-blocking I/O
    eventlet.monkey_patch() 
    ASYNC_MODE = 'eventlet'
except ImportError:
    ASYNC_MODE = 'threading'
    print("Warning: eventlet not installed. Falling back to threading mode for SocketIO.")
# ----------------------------

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
# NOTE: Ensure these are set correctly on Render
TELEGRAM_BOT_TOKEN: Optional[str] = os.getenv("TELEGRAM_BOT_TOKEN")
RENDER_FRONTEND_URL: Optional[str] = os.getenv('RENDER_FRONTEND_URL') 
RENDER_EXTERNAL_URL: Optional[str] = os.getenv("RENDER_EXTERNAL_URL") 
YOUTUBE_API_KEY: Optional[str] = os.getenv("YOUTUBE_API_KEY") 

WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' if TELEGRAM_BOT_TOKEN else '/webhook/dummy_token'

# --- Global Objects ---
app = Flask(__name__)
socketio = SocketIO(app, async_mode=ASYNC_MODE, cors_allowed_origins="*", logger=True, engineio_logger=True)

application: Optional[Application] = None
bot: Optional[Application.bot] = None
initialization_lock = threading.Lock() 

# ------------------------------------------------------------------
# --- BOT HANDLERS ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Welcome! Type `/play` to start the group music player.")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set on the server.')
        return
        
    chat_id = update.effective_chat.id
    # Ensure the URL is correctly constructed with HTTPS 
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
# --- PTB Initialization ---
# ------------------------------------------------------------------

def initialize_ptb_application():
    global application, bot
    
    with initialization_lock:
        if application: 
            return
        
        if not TELEGRAM_BOT_TOKEN: 
            logger.critical("CRITICAL: TELEGRAM_BOT_TOKEN is missing!"); 
            return

        app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
        application = app_builder.build()
        bot = application.bot
        setup_handlers(application)
        
        webhook_url = f'{RENDER_EXTERNAL_URL}{WEBHOOK_PATH}'
        
        try:
            # FIX: Use asyncio.run in a dedicated thread to initialize and set the webhook.
            async def init_ptb_and_set_webhook():
                await application.initialize() 
                
                if RENDER_EXTERNAL_URL:
                     success = await bot.set_webhook(url=webhook_url)
                     if success:
                         logger.info(f"Auto-Webhook successfully set to {webhook_url}")
                     else:
                         logger.error("Auto-Webhook setting failed.")
                
                # Start the PTB background tasks 
                await application.start() 
                logger.info("PTB Application started successfully.")

            # Run the asynchronous initialization in a separate, dedicated thread.
            thread = threading.Thread(target=lambda: asyncio.run(init_ptb_and_set_webhook()))
            thread.start()
            
        except Exception as e:
            logger.critical(f"FATAL ERROR during PTB initialization/Webhook set: {e}", exc_info=True)
            application = None; bot = None

# ------------------------------------------------------------------
# --- GLOBAL CORS FIX ---
# ------------------------------------------------------------------

@app.after_request
def after_request(response):
    """Manually sets CORS headers to resolve 'Failed to fetch' issues."""
    header = response.headers
    header['Access-Control-Allow-Origin'] = '*'
    header['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    header['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response


# ------------------------------------------------------------------
# --- WEBHOOK ENDPOINT (THE FINAL FIX) ---
# ------------------------------------------------------------------

def process_ptb_update(update):
    """Runs the asynchronous PTB update processing within the asyncio event loop."""
    if not application:
        logger.error("Attempted to process update before application was ready.")
        return
    
    # Get the existing event loop for the PTB thread
    try:
        loop = application.loop
    except AttributeError:
        # Fallback if application.loop isn't directly exposed 
        logger.error("Cannot access application loop. PTB may not be fully started.")
        return

    # Create a future/task to process the update and submit it to the application's loop
    async def run_update():
        await application.process_update(update)

    # Use asyncio.run_coroutine_threadsafe to safely schedule the task from a non-async thread (Eventlet's green thread)
    asyncio.run_coroutine_threadsafe(run_update(), loop)
    logger.info(f"Update successfully submitted to PTB's asyncio loop.")


@app.route(WEBHOOK_PATH, methods=['POST'])
def telegram_webhook():
    if request.method == "POST":
        
        # 1. Initialization Check: Wait briefly if application is not ready (Fix for 500 Error)
        if not application or not bot:
            logger.warning("Bot not fully initialized. Waiting briefly.")
            for _ in range(20): 
                eventlet.sleep(0.1) 
                if application and bot:
                    break
            
            if not application or not bot:
                logger.error("Bot initialization failed to complete. Returning 500.")
                return jsonify({'status': 'error', 'message': 'Bot not ready after wait'}), 500
        
        # 2. Process Update
        try:
            # Parse the incoming JSON update
            update = Update.de_json(request.get_json(force=True), bot) 
            
            # CRITICAL FIX: Spawn the synchronous helper function to handle asyncio conflict
            eventlet.spawn(process_ptb_update, update)

            # Return 'ok' immediately (This is the required 200 response for Telegram)
            return 'ok'
        except Exception as e:
            logger.error(f"Error processing update: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Update processing failed'}), 500
    return abort(400)


# ------------------------------------------------------------------
# --- YOUTUBE DATA API SEARCH ENDPOINT ---
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
        # Synchronous httpx call (eventlet patched)
        response = httpx.get(YOUTUBE_SEARCH_URL, params=params) 
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
        
    except httpx.HTTPError as e: 
        logger.error(f"YouTube API Error: {e}", exc_info=True)
        return jsonify({'error': f'Failed to search YouTube: {e}'}), 500


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

# --- Health Check ---

@app.route('/')
def health_check():
    """Simple health check for Render."""
    return "Music Bot Backend is alive and ready for sync and search!", 200

# ------------------------------------------------------------------
# --- MAIN RUN ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    initialize_ptb_application() 
    
    # Give the PTB initialization thread a moment to set the webhook
    if ASYNC_MODE == 'eventlet':
        eventlet.sleep(2) 
        
    PORT = int(os.environ.get('PORT', 8000))
    
    logger.info(f"Starting server in {ASYNC_MODE} mode on port {PORT}...")
    socketio.run(app, host='0.0.0.0', port=PORT, debug=False)
