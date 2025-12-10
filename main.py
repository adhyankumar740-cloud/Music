import os
import logging
import asyncio
import re 
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
# Vercel की जगह अब Render Frontend URL का उपयोग करें
RENDER_FRONTEND_URL = os.getenv('RENDER_FRONTEND_URL') 
RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL") 

# Secure Webhook Path
WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' 

# --- Global Music & PTB Objects ---
MUSIC_FILE_PATH = os.path.join(os.getcwd(), "music", "sample.mp3") 
application = None
bot = None

# ------------------------------------------------------------------
# --- BOT HANDLERS ---
# ------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("म्यूजिक प्लेयर शुरू करने के लिए `/play` टाइप करें।")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # VERCEL_FRONTEND_URL की जगह RENDER_FRONTEND_URL चेक करें
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    keyboard = [[
        InlineKeyboardButton(
            "🎶 ओपन म्यूजिक प्लेयर", 
            # RENDER_FRONTEND_URL का उपयोग करें
            web_app={"url": RENDER_FRONTEND_URL}
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        'मस्त म्यूजिक सुनने के लिए प्लेयर खोलें:', 
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
# --- FLASK APPLICATION SETUP & PTB INITIALIZATION ---
# ------------------------------------------------------------------

app = Flask(__name__)

def initialize_ptb_application():
    global application, bot
    if application: return
    if not TELEGRAM_BOT_TOKEN: logger.critical("CRITICAL: TELEGRAM_BOT_TOKEN is missing!"); return

    app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    application = app_builder.build()
    bot = application.bot
    setup_handlers(application)
    
    try:
        async def init_ptb(): await application.initialize()
        asyncio.run(init_ptb()) 
        logger.info("PTB Application initialized successfully for Webhook mode.")
    except Exception as e:
        logger.critical(f"FATAL ERROR during PTB initialization: {e}")
        application = None; bot = None

@app.before_request
def before_request_hook():
    initialize_ptb_application()

# --- WEBHOOK ENDPOINTS ---
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
def set_webhook():
    if not RENDER_EXTERNAL_URL or not TELEGRAM_BOT_TOKEN: return jsonify({'status': 'error', 'message': 'RENDER_EXTERNAL_URL or TOKEN not set.'}), 500
    if not application or not bot: initialize_ptb_application() 
    if not application or not bot: return jsonify({'status': 'error', 'message': 'Application initialization failed.'}), 500

    webhook_url = f'{RENDER_EXTERNAL_URL}{WEBHOOK_PATH}'
    try:
        async def run_set_webhook(): return await bot.set_webhook(url=webhook_url)
        # Event Loop Error Fix
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        s = loop.run_until_complete(run_set_webhook())
        loop.close()
        
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

@app.route('/stream-audio', methods=['GET', 'HEAD']) 
def stream_audio():
    """Streams the audio file with range headers for seeking, including CORS headers."""
    try:
        if not os.path.exists(MUSIC_FILE_PATH):
            logger.error(f"Music file not found at {MUSIC_FILE_PATH}")
            return "Music file not found", 404

        file_size = os.path.getsize(MUSIC_FILE_PATH)
        range_header = request.headers.get('Range')
        
        headers = {
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*', 
            'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
            'Access-Control-Allow-Methods': 'GET, HEAD'
        }
        
        if not range_header:
            # Full file requested 
            response = send_file(MUSIC_FILE_PATH, mimetype='audio/mpeg')
            response.headers.update(headers)
            response.headers['Content-Length'] = str(file_size)
            return response

        # --- Handle Partial Content (Seeking) ---
        match = re.search(r'bytes=(\d+)-(\d*)', range_header)
        start_byte = int(match.group(1)) if match.group(1) else 0
        
        CHUNK_SIZE = 5 * 1024 * 1024 
        
        if match.group(2):
            end_byte = int(match.group(2))
        else:
            end_byte = min(start_byte + CHUNK_SIZE - 1, file_size - 1)

        end_byte = min(end_byte, file_size - 1)
        length = end_byte - start_byte + 1

        with open(MUSIC_FILE_PATH, 'rb') as f:
            f.seek(start_byte)
            data = f.read(length)
            
        # Update headers for 206 response
        headers['Content-Length'] = str(length)
        headers['Content-Range'] = f'bytes {start_byte}-{end_byte}/{file_size}'
        
        return data, 206, headers 
        
    except Exception as e:
        logger.error(f"Streaming error: {e}", exc_info=True)
        return "Internal Server Error during streaming", 500


@app.route('/stream-audio', methods=['OPTIONS'])
def stream_audio_options():
    """Handles the CORS pre-flight request."""
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
        'Access-Control-Max-Age': '3600'
    }
    return '', 204, headers


# --- Health Check ---

@app.route('/')
def health_check():
    """Simple health check for Render."""
    return "Music Bot Backend is alive and ready for streaming!", 200

# ------------------------------------------------------------------
# --- MAIN RUN ---
# ------------------------------------------------------------------

if __name__ == '__main__':
    initialize_ptb_application() 
    PORT = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=PORT)
