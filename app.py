import os
import logging
import asyncio
import io
from flask import Flask, send_file, request, jsonify, abort
from telegram import Update, Bot, InlineKeyboardButton, InlineKeyboardMarkup
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
# Vercel Frontend URL (Mini App)
VERCEL_FRONTEND_URL = os.getenv('VERCEL_FRONTEND_URL') 
# Render External URL (Backend/Webhook URL)
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL") 

# Unique path for Telegram webhook (Security)
WEBHOOK_PATH = f'/{TELEGRAM_BOT_TOKEN}' 

# --- Global Music & PTB Objects ---
MUSIC_FILE_PATH = "music/sample.mp3" 
application = None
bot = None

# ------------------------------------------------------------------
# --- BOT HANDLERS (Music Bot Logic) ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /start command."""
    await update.message.reply_text("म्यूजिक प्लेयर शुरू करने के लिए `/play` टाइप करें।")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /play command and sends the Mini App link."""
    
    if not VERCEL_FRONTEND_URL:
        await update.message.reply_text('Error: VERCEL_FRONTEND_URL environment variable is not set.')
        return
        
    keyboard = [[
        InlineKeyboardButton(
            "🎶 ओपन म्यूजिक प्लेयर", 
            web_app={"url": VERCEL_FRONTEND_URL}
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        'मस्त म्यूजिक सुनने के लिए प्लेयर खोलें:', 
        reply_markup=reply_markup
    )

async def handle_text_messages(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles general text messages."""
    await update.message.reply_text("मुझे बस म्यूजिक चलाने के लिए प्रोग्राम किया गया है। `/play` का उपयोग करें।")

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Log the error and handle exceptions."""
    logger.error("Exception while handling an update:", exc_info=context.error)

def setup_handlers(app_ptb: Application):
    """Adds all command and message handlers to the PTB Application."""
    logger.info("Setting up Music Bot handlers...")
    
    app_ptb.add_handler(CommandHandler("start", start_command))
    app_ptb.add_handler(CommandHandler("play", play_command))
    
    # Generic text handler
    app_ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_messages))
    
    app_ptb.add_error_handler(error_handler)
    logger.info("All handlers set up.")

# ------------------------------------------------------------------
# --- FLASK APPLICATION SETUP & PTB INITIALIZATION ---
# ------------------------------------------------------------------

app = Flask(__name__)

def initialize_ptb_application():
    """Initializes PTB application."""
    global application, bot
    if application:
        return

    if not TELEGRAM_BOT_TOKEN:
        logger.critical("CRITICAL: TELEGRAM_BOT_TOKEN is missing!")
        return

    # Build the PTB Application
    app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    application = app_builder.build()
    bot = application.bot
    
    # Setup Handlers
    setup_handlers(application)
    
    # Initialize the application (for webhook mode)
    try:
        async def init_ptb():
            await application.initialize()
        
        asyncio.run(init_ptb()) 
        logger.info("PTB Application initialized successfully for Webhook mode.")
    except Exception as e:
        logger.critical(f"FATAL ERROR during PTB initialization: {e}")
        application = None
        bot = None

# Hook to ensure PTB is ready for Gunicorn
@app.before_request
def before_request_hook():
    initialize_ptb_application()

# ------------------------------------------------------------------
# --- WEBHOOK ENDPOINTS (The Core Fix) ---
# ------------------------------------------------------------------

@app.route(WEBHOOK_PATH, methods=['POST'])
async def telegram_webhook():
    """The main endpoint where Telegram sends updates (MUST BE ASYNC)."""
    if request.method == "POST":
        if not application or not bot:
             logger.error("Application/Bot not initialized.")
             return jsonify({'status': 'error', 'message': 'Bot not ready'}), 500

        try:
            update = Update.de_json(request.get_json(force=True), bot)
            await application.process_update(update)
            return 'ok'
        except Exception as e:
            logger.error(f"Error processing update: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Update processing failed'}), 500
    
    return abort(400)


@app.route('/set-webhook', methods=['GET'])
def set_webhook():
    """Manually sets the Telegram Webhook (Fixes Event Loop Error)."""
    
    if not RENDER_EXTERNAL_URL or not TELEGRAM_BOT_TOKEN:
        return jsonify({'status': 'error', 'message': 'RENDER_EXTERNAL_URL or TOKEN not set.'}), 500

    if not application or not bot:
        initialize_ptb_application() 
        if not application or not bot:
             return jsonify({'status': 'error', 'message': 'Application initialization failed.'}), 500

    webhook_url = f'{RENDER_EXTERNAL_URL}{WEBHOOK_PATH}'
    
    try:
        async def run_set_webhook():
            return await bot.set_webhook(url=webhook_url)

        # The fix: Safely run the async method in a sync context
        s = asyncio.run(run_set_webhook())
        
        if s:
            logger.info(f"Webhook successfully set to {webhook_url}")
            return jsonify({'status': 'success', 'message': f'Webhook successfully set to {webhook_url}'})
        else:
            return jsonify({'status': 'error', 'message': 'Telegram API call to set Webhook failed.'}), 500
            
    except Exception as e:
        logger.error(f"Error setting webhook: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': f'Exception during webhook setup: {e}'}), 500

# ------------------------------------------------------------------
# --- AUDIO STREAMING ENDPOINT ---
# ------------------------------------------------------------------

@app.route('/stream-audio')
def stream_audio():
    """Streams the audio file with range headers for seeking."""
    try:
        if not os.path.exists(MUSIC_FILE_PATH):
            logger.error(f"Music file not found at {MUSIC_FILE_PATH}")
            return "Music file not found", 404

        range_header = request.headers.get('Range', None)
        file_size = os.path.getsize(MUSIC_FILE_PATH)
        
        if not range_header:
            return send_file(MUSIC_FILE_PATH, mimetype='audio/mpeg')

        # Logic for Partial Content Streaming (seeking)
        byte_range = range_header.replace('bytes=', '').split('-')
        start_byte = int(byte_range[0])
        chunk_size = 1024 * 512
        end_byte = min(start_byte + chunk_size, file_size - 1)
        
        content_range = f'bytes {start_byte}-{end_byte}/{file_size}'
        
        with open(MUSIC_FILE_PATH, 'rb') as f:
            f.seek(start_byte)
            data = f.read(end_byte - start_byte + 1)
            
        headers = {
            'Content-Type': 'audio/mpeg',
            'Content-Length': str(end_byte - start_byte + 1),
            'Content-Range': content_range,
            'Accept-Ranges': 'bytes'
        }
        
        return data, 206, headers # 206 Partial Content Status
        
    except Exception as e:
        logger.error(f"Streaming error: {e}")
        return "Internal Server Error", 500

# --- Health Check ---

@app.route('/')
def health_check():
    """Simple health check for Render."""
    return "Music Bot Backend is alive and ready for streaming!", 200

# ------------------------------------------------------------------
# --- MAIN RUN ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    # Initialize the app before running locally
    initialize_ptb_application() 
    PORT = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=PORT)
