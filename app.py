import os
import logging
import asyncio # For running async initialize and set_webhook synchronously
from flask import Flask, send_file, request, jsonify, abort
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
# PTB v20+ के लिए सही इम्पोर्ट्स
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# --- Logging Setup (Debugging के लिए) ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Configuration (Environment Variables) ---
# सुनिश्चित करें कि ये Render Settings में सेट हैं!
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN') 
VERCEL_FRONTEND_URL = os.environ.get('VERCEL_FRONTEND_URL') 
RENDER_EXTERNAL_URL = os.environ.get('RENDER_EXTERNAL_URL') 

# --- Flask App and PTB Application Setup ---
app = Flask(__name__)

# PTB ApplicationBuilder का उपयोग करके Application ऑब्जेक्ट बनाएँ
if TELEGRAM_BOT_TOKEN:
    application = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    bot = application.bot
else:
    logger.error("TELEGRAM_BOT_TOKEN is missing. Application cannot be built.")
    # Placeholder
    class DummyApp:
        def add_handler(self, handler): pass
        def __getattr__(self, name): return None 
    application = DummyApp()
    bot = None

# --- Music File Path and Handlers ---
MUSIC_FILE_PATH = "Tum Hi Ho (From Aashiqui 2).mp3" 

# Handler function must be async in PTB v20+
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
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

if TELEGRAM_BOT_TOKEN:
    application.add_handler(CommandHandler("play", start_command))

# --- Webhook Endpoint for Telegram (MUST BE ASYNC) ---

@app.route('/telegram-webhook', methods=['POST'])
async def telegram_webhook():
    """Main endpoint where Telegram sends updates and Application processes them."""
    if request.method == "POST":
        if not TELEGRAM_BOT_TOKEN:
             return 'Bot token missing', 500
             
        # process_update एक async फ़ंक्शन है
        await application.process_update(
            Update.de_json(request.get_json(force=True), bot)
        )
        return 'ok'
    return abort(400)

# --- Webhook Setup Utility (Synchronous Fix for Event Loop Error) ---

@app.route('/set-webhook', methods=['GET'])
def set_webhook():
    """Sets the Telegram Webhook to point to the Render URL."""
    if not RENDER_EXTERNAL_URL or not TELEGRAM_BOT_TOKEN:
        return jsonify({'status': 'error', 'message': 'RENDER_EXTERNAL_URL or TOKEN not set.'}), 500

    webhook_url = f'{RENDER_EXTERNAL_URL}/telegram-webhook'
    
    try:
        # Helper function to perform the async webhook setting
        async def run_set_webhook():
            return await bot.set_webhook(url=webhook_url)

        # asyncio.run() का उपयोग करके async method को sync main thread में चलाएँ
        s = asyncio.run(run_set_webhook())
        
        if s:
            return jsonify({'status': 'success', 'message': f'Webhook successfully set to {webhook_url}'})
        else:
            return jsonify({'status': 'error', 'message': 'Telegram API call to set Webhook failed.'}), 500
            
    except RuntimeError as e:
        logger.error(f"Event Loop RuntimeError setting webhook: {e}")
        return jsonify({'status': 'error', 'message': f'Failed to set webhook due to Event Loop conflict: {e}'}), 500
    except Exception as e:
        logger.error(f"Error setting webhook: {e}")
        return jsonify({'status': 'error', 'message': f'Exception during webhook setup: {e}'}), 500


# --- Audio Streaming Endpoint (Synchronous) ---

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

# --- Health Check (For Render and Keep-Alive) ---

@app.route('/')
def health_check():
    return "Bot is awake and streaming service is running!", 200

# --- Main App Run: Initialization Fix for Webhook ---

if __name__ == '__main__':
    # Webhook mode के लिए Application को सही ढंग से इनिशियलाइज़ करें
    if TELEGRAM_BOT_TOKEN:
        try:
            # Helper function to run the async initialize method in synchronous __main__
            async def initialize_application():
                await application.initialize()
                logger.info("PTB Application initialized for Webhook mode.")
            
            # asyncio.run() का उपयोग करके async initialization को sync main thread में चलाएँ
            asyncio.run(initialize_application())

        except Exception as e:
            logger.error(f"Error during PTB application initialization: {e}")
            exit(1)

    port = int(os.environ.get('PORT', 5000))
    # Flask app को रन करें (यह PTB के Webhook को हैंडल करेगा)
    app.run(host='0.0.0.0', port=port)
