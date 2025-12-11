import os
import logging
import asyncio
import threading # NEW: Threading Lock के लिए
import re 
import requests 
from flask import Flask, send_file, request, jsonify, abort
from flask_socketio import SocketIO, join_room, emit, disconnect
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
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
RENDER_FRONTEND_URL = os.getenv('RENDER_FRONTEND_URL') 
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL") 
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY") # YouTube API Key for Search

WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' 

# --- Global Objects ---
app = Flask(__name__)
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*", logger=True, engineio_logger=True)

application = None
bot = None
initialization_lock = threading.Lock() # NEW: Initalization Lock

# ------------------------------------------------------------------
# --- BOT HANDLERS ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("YouTube ग्रुप म्यूजिक प्लेयर शुरू करने के लिए `/play` टाइप करें।")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    chat_id = update.effective_chat.id
    player_url = f"{RENDER_FRONTEND_URL}?chat_id={chat_id}&mode=search"

    keyboard = [[
        InlineKeyboardButton(
            "▶️ YouTube म्यूजिक खोजें और चलाएँ", 
            web_app={"url": player_url}
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        'ग्रुप में सुनने के लिए प्लेयर खोलें और गाना खोजें:', 
        reply_markup=reply_markup
    )

async def handle_text_messages(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("मुझे बस म्यूजिक चलाने के लिए प्रोग्राम किया गया है। `/play` का उपयोग करें।")

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
# --- PTB Initialization with Threading Lock (FIXED) ---
# ------------------------------------------------------------------

def initialize_ptb_application():
    global application, bot
    
    # थ्रेडिंग लॉक का उपयोग करें
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
            async def init_ptb_and_set_webhook():
                # application.initialize() को पूरा होने दें
                await application.initialize() 
                
                # Webhook सेट करना
                if RENDER_EXTERNAL_URL:
                     success = await bot.set_webhook(url=webhook_url)
                     if success:
                         logger.info(f"Auto-Webhook successfully set to {webhook_url}")
                     else:
                         logger.error("Auto-Webhook setting failed.")
                
            # Asynchronous फ़ंक्शन को Sync context में चलाएँ
            # Note: loop.run_until_complete() को यहां ठीक से इस्तेमाल किया गया है
            loop = asyncio.get_event_loop()
            loop.run_until_complete(init_ptb_and_set_webhook()) 
            
            logger.info("PTB Application initialized successfully for Webhook mode.")
        except Exception as e:
            logger.critical(f"FATAL ERROR during PTB initialization/Webhook set: {e}")
            application = None; bot = None

# ------------------------------------------------------------------
# --- WEBHOOK ENDPOINT (FIXED: Handling Async in Sync Context) ---
# ------------------------------------------------------------------

@app.route(WEBHOOK_PATH, methods=['POST'])
def telegram_webhook():
    if request.method == "POST":
        if not application or not bot: 
            return jsonify({'status': 'error', 'message': 'Bot not ready'}), 500
        try:
            update = Update.de_json(request.get_json(force=True), bot)
            
            # FIXED: async application.process_update को sync context में सुरक्षित रूप से चलाएँ
            loop = asyncio.get_event_loop()
            loop.run_until_complete(application.process_update(update))

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
# --- SOCKETIO (REAL-TIME GROUP LISENING) HANDLERS ---
# ------------------------------------------------------------------

@socketio.on('join_group')
def handle_join_group(data):
    chat_id = str(data.get('chat_id'))
    if chat_id:
        join_room(chat_id)
        logger.info(f"Client joined room: {chat_id}")
        emit('status_message', {'message': 'New member joined. Syncing...'}, room=chat_id)
    else:
        logger.warning("Client tried to join group without chat_id.")

@socketio.on('control_stream')
def handle_control_stream(data):
    chat_id = str(data.get('chat_id'))
    action = data.get('action') 
    time = data.get('time', 0) 
    
    if chat_id and action:
        logger.info(f"Control from {request.sid} in {chat_id}: {action} at {time}s")
        
        emit('sync_control', 
             {'action': action, 'time': time, 'video_id': data.get('video_id')}, 
             room=chat_id, 
             skip_sid=request.sid 
        )

# --- Health Check ---

@app.route('/')
def health_check():
    """Simple health check for Render."""
    return "Music Bot Backend is alive and ready for sync and search!", 200

# ------------------------------------------------------------------
# --- MAIN RUN (FIXED: Initialization called once) ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    # Webhook त्रुटि से बचने के लिए startup पर एक बार इनिशियलाइज़ करें
    initialize_ptb_application() 
    
    PORT = int(os.environ.get('PORT', 8000))
    # Flask-SocketIO को चलाएँ
    socketio.run(app, host='0.0.0.0', port=PORT, debug=False)
