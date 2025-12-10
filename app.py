import os
import logging
import asyncio
import re 
from flask import Flask, send_file, request, jsonify, abort
from flask_socketio import SocketIO, join_room, leave_room, emit, disconnect
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

# --- Configuration ---
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
RENDER_FRONTEND_URL = os.getenv('RENDER_FRONTEND_URL') 
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL") 
WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' 
MUSIC_FILE_PATH = os.path.join(os.getcwd(), "music", "sample.mp3") 

# --- Global Objects ---
app = Flask(__name__)
# Flask-SocketIO initialization (async_mode='threading' is safer with Flask)
socketio = SocketIO(app, async_mode='threading', cors_allowed_origins="*", logger=True, engineio_logger=True)

application = None
bot = None

# --- PTB Handlers ---
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("म्यूजिक प्लेयर शुरू करने के लिए `/play` टाइप करें।")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    # हम Web App URL में Chat ID को जोड़ रहे हैं ताकि Frontend जान सके कि किस ग्रुप में शामिल होना है।
    chat_id = update.effective_chat.id
    player_url = f"{RENDER_FRONTEND_URL}?chat_id={chat_id}"

    keyboard = [[
        InlineKeyboardButton(
            "🎶 ओपन ग्रुप म्यूजिक प्लेयर", 
            web_app={"url": player_url}
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        'ग्रुप में सुनने के लिए प्लेयर खोलें:', 
        reply_markup=reply_markup
    )
# ... (अन्य हैंडलर समान हैं) ...

def setup_handlers(app_ptb: Application):
    logger.info("Setting up Music Bot handlers...")
    app_ptb.add_handler(CommandHandler("start", start_command))
    app_ptb.add_handler(CommandHandler("play", play_command))
    # ... (अन्य हैंडलर जोड़ें) ...
    logger.info("All handlers set up.")


# --- PTB Initialization with Auto Webhook Fix ---
def initialize_ptb_application():
    global application, bot
    if application: return
    if not TELEGRAM_BOT_TOKEN: logger.critical("CRITICAL: TELEGRAM_BOT_TOKEN is missing!"); return

    app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    application = app_builder.build()
    bot = application.bot
    setup_handlers(application)
    
    webhook_url = f'{RENDER_EXTERNAL_URL}{WEBHOOK_PATH}'
    
    try:
        async def init_ptb_and_set_webhook():
            await application.initialize()
            if RENDER_EXTERNAL_URL:
                 success = await bot.set_webhook(url=webhook_url)
                 if success:
                     logger.info(f"Auto-Webhook successfully set to {webhook_url}")
                 else:
                     logger.error("Auto-Webhook setting failed.")
            
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(init_ptb_and_set_webhook()) 
        loop.close()
        logger.info("PTB Application initialized successfully for Webhook mode.")
    except Exception as e:
        logger.critical(f"FATAL ERROR during PTB initialization/Webhook set: {e}")
        application = None; bot = None

# Set up initialization hook
@app.before_request
def before_request_hook():
    initialize_ptb_application()


# --- WEBHOOK & SET-WEBHOOK ENDPOINTS (Slightly adjusted for clarity) ---

@app.route(WEBHOOK_PATH, methods=['POST'])
async def telegram_webhook():
    if request.method == "POST":
        if not application or not bot: return jsonify({'status': 'error', 'message': 'Bot not ready'}), 500
        try:
            update = Update.de_json(request.get_json(force=True), bot)
            await application.process_update(update)
            return 'ok'
        except Exception as e:
            logger.error(f"Error processing update: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Update processing failed'}), 500
    return abort(400)

@app.route('/set-webhook', methods=['GET'])
# /set-webhook को मैन्युअल रूप से चलाने की आवश्यकता नहीं है (क्योंकि यह ऑटो-सेटअप में है) 
# लेकिन इसे डिबगिंग के लिए यहाँ रखा गया है।

# --- AUDIO STREAMING ENDPOINT (Unchanged) ---
@app.route('/stream-audio', methods=['GET', 'HEAD']) 
def stream_audio():
    # ... (Audio streaming logic here, same as before) ...
    # आपको इस सेक्शन को पुराने कोड से कॉपी करना होगा
    pass # Implementation skipped for brevity, use the old code.

@app.route('/stream-audio', methods=['OPTIONS'])
def stream_audio_options():
    # ... (CORS logic here, same as before) ...
    pass # Implementation skipped for brevity, use the old code.


# ------------------------------------------------------------------
# --- SOCKETIO (REAL-TIME GROUP LISTENING) HANDLERS ---
# ------------------------------------------------------------------

@socketio.on('connect')
def handle_connect():
    """Client connects; does nothing special yet."""
    logger.info("Client connected.")

@socketio.on('join_group')
def handle_join_group(data):
    """Client joins a group (room) based on the chat_id provided by the Web App URL."""
    chat_id = str(data.get('chat_id'))
    if chat_id:
        join_room(chat_id)
        logger.info(f"Client joined room: {chat_id}")
        # Group को बताएं कि एक नया सदस्य जुड़ा है
        emit('status_message', {'message': 'New member joined the group stream.'}, room=chat_id)
    else:
        logger.warning("Client tried to join group without chat_id.")

@socketio.on('control_stream')
def handle_control_stream(data):
    """Handles play, pause, and seek commands from one group member and relays to others."""
    chat_id = str(data.get('chat_id'))
    action = data.get('action') # 'play', 'pause', 'seek'
    time = data.get('time', 0) # Current playback time
    
    if chat_id and action:
        logger.info(f"Control from {chat_id}: {action} at {time}s")
        
        # इस कमांड को ग्रुप के सभी अन्य सदस्यों को भेजें
        # broadcast=True का उपयोग न करें, बल्कि 'room' का उपयोग करें
        emit('sync_control', 
             {'action': action, 'time': time}, 
             room=chat_id, 
             skip_sid=request.sid # कमांड भेजने वाले क्लाइंट को छोड़कर
        )

# ------------------------------------------------------------------
# --- MAIN RUN ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    # Flask-SocketIO का उपयोग करते समय, हमें app.run() की जगह socketio.run() का उपयोग करना होगा।
    # यह Flask और WebSockets दोनों को संभालता है।
    initialize_ptb_application() 
    PORT = int(os.environ.get('PORT', 8000))
    # NOTE: Debug mode को Production में False रखें।
    socketio.run(app, host='0.0.0.0', port=PORT, debug=True)
