import os
import logging
from flask import Flask, send_file, request, jsonify, abort
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
# PTB v20+ के लिए सही इम्पोर्ट्स
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# --- Logging Setup (Debugging के लिए) ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Configuration (Environment Variables) ---
# Ensure these are set in Render settings!
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
    # Placeholder to prevent runtime errors if token is missing during deployment
    class DummyApp:
        def add_handler(self, handler): pass
        def __getattr__(self, name): return None # Dummy attribute access
    application = DummyApp()
    bot = None

# --- Music File Path and Handlers ---

# सुनिश्चित करें कि आपके प्रोजेक्ट में 'music' फ़ोल्डर के अंदर 'sample.mp3' फ़ाइल मौजूद है।
MUSIC_FILE_PATH = "Tum Hi Ho (From Aashiqui 2).mp3" 

# ContextTypes.DEFAULT_TYPE नए PTB वर्ज़न में इस्तेमाल होता है
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

    # await update.message.reply_text (PTB v20+ में अनिवार्य)
    await update.message.reply_text(
        'मस्त म्यूजिक सुनने के लिए प्लेयर खोलें:', 
        reply_markup=reply_markup
    )

# कमांड हैंडलर को Application में जोड़ें (सिर्फ़ तभी जब टोकन मौजूद हो)
if TELEGRAM_BOT_TOKEN:
    application.add_handler(CommandHandler("play", start_command))

# --- Webhook Endpoint for Telegram (MUST BE ASYNC) ---

@app.route('/telegram-webhook', methods=['POST'])
async def telegram_webhook():
    """Main endpoint where Telegram sends updates and Application processes them."""
    if request.method == "POST":
        if not TELEGRAM_BOT_TOKEN:
             return 'Bot token missing', 500
             
        # process_update एक async फ़ंक्शन है जिसे await करना ज़रूरी है
        await application.process_update(
            Update.de_json(request.get_json(force=True), bot)
        )
        return 'ok'
    return abort(400)

# --- Webhook Setup Utility (Fixes RuntimeWarning by using await) ---

@app.route('/set-webhook', methods=['GET'])
async def set_webhook():
    """Sets the Telegram Webhook to point to the Render URL."""
    if not RENDER_EXTERNAL_URL or not TELEGRAM_BOT_TOKEN:
        return jsonify({'status': 'error', 'message': 'RENDER_EXTERNAL_URL or TOKEN not set.'}), 500

    webhook_url = f'{RENDER_EXTERNAL_URL}/telegram-webhook'
    
    try:
        # set_webhook एक async फ़ंक्शन है, इसलिए 'await' का उपयोग करें
        s = await bot.set_webhook(url=webhook_url)
        if s:
            return jsonify({'status': 'success', 'message': f'Webhook successfully set to {webhook_url}'})
        else:
            return jsonify({'status': 'error', 'message': 'Telegram API call to set Webhook failed.'}), 500
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
            # 1. Application को initialize करें (Required to fix RuntimeError)
            application.initialize()
            
            # 2. Webhook environment के लिए Application को तैयार करें
            application.setup_webhook(webhook_url="https://dummy-url.com")
            
            logger.info("PTB Application initialized for Webhook mode.")
            
        except Exception as e:
            logger.error(f"Error during PTB application initialization: {e}")
            exit(1)

    port = int(os.environ.get('PORT', 5000))
    # Flask app को रन करें (यह PTB के Webhook को हैंडल करेगा)
    app.run(host='0.0.0.0', port=port)
