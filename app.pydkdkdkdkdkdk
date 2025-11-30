import os
import logging
from flask import Flask, send_file, request, jsonify, abort
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
# PTB v20+ के लिए सही इम्पोर्ट्स
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Configuration (Environment Variables) ---
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN') 
VERCEL_FRONTEND_URL = os.environ.get('VERCEL_FRONTEND_URL') 
RENDER_EXTERNAL_URL = os.environ.get('RENDER_EXTERNAL_URL') 

# --- Flask App and PTB Application Setup ---
app = Flask(__name__)

# ApplicationBuilder को Webhook मोड के लिए तैयार करें
if TELEGRAM_BOT_TOKEN:
    application = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    bot = application.bot
else:
    logger.error("TELEGRAM_BOT_TOKEN is missing. Application cannot be built.")
    # Fallback/Dummy application for deployment success
    class DummyApp:
        def add_handler(self, handler): pass
        def bot(self): pass
    application = DummyApp()
    bot = None

# --- Music File Path and Handlers ---
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

    await update.message.reply_text(
        'मस्त म्यूजिक सुनने के लिए प्लेयर खोलें:', 
        reply_markup=reply_markup
    )

# कमांड हैंडलर को Application में जोड़ें
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


# --- Audio Streaming Endpoint (No change needed here) ---

@app.route('/stream-audio')
def stream_audio():
    # ... (Audio Streaming logic unchanged, as it is synchronous)
    try:
        if not os.path.exists(MUSIC_FILE_PATH):
            logger.error(f"Music file not found at {MUSIC_FILE_PATH}")
            return "Music file not found", 404

        range_header = request.headers.get('Range', None)
        file_size = os.path.getsize(MUSIC_FILE_PATH)
        
        if not range_header:
            return send_file(MUSIC_FILE_PATH, mimetype='audio/mpeg')

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
        
        return data, 206, headers
        
    except Exception as e:
        logger.error(f"Streaming error: {e}")
        return "Internal Server Error", 500

# --- Health Check ---

@app.route('/')
def health_check():
    return "Bot is awake and streaming service is running!", 200

# --- Main App Run ---

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    # Werkzeug (Flask's internal server) Python 3.11+ में async फ़ंक्शंस को सपोर्ट करता है।
    app.run(host='0.0.0.0', port=port)
