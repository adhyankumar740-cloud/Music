import os
import logging
from flask import Flask, send_file, request, jsonify, abort
from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes
from io import BytesIO

# --- Logging Setup (Debugging के लिए) ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Configuration (Set these as Environment Variables on Render) ---
# ⚠️ इन्हें Render Settings -> Environment में सेट करें 
# (जरूरी: TELEGRAM_BOT_TOKEN, VERCEL_FRONTEND_URL, RENDER_EXTERNAL_URL)

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN') 
VERCEL_FRONTEND_URL = os.environ.get('VERCEL_FRONTEND_URL') # आपके Vercel App का URL
RENDER_EXTERNAL_URL = os.environ.get('RENDER_EXTERNAL_URL') # Render द्वारा दिया गया आपका URL

# --- Flask App and PTB Application Setup ---

app = Flask(__name__)

if not TELEGRAM_BOT_TOKEN:
    logger.error("TELEGRAM_BOT_TOKEN is missing. Bot will not function.")
else:
    # PTB ApplicationBuilder का उपयोग करके Application ऑब्जेक्ट बनाएँ
    application = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    bot = application.bot # Bot ऑब्जेक्ट को आसानी से एक्सेस करने के लिए

# --- Music File Path and Handlers ---

# सुनिश्चित करें कि आपके प्रोजेक्ट में 'music' फ़ोल्डर के अंदर 'sample.mp3' फ़ाइल मौजूद है।
MUSIC_FILE_PATH = "Tum Hi Ho (From Aashiqui 2).mp3" 

def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /play command and sends the Mini App link."""
    
    if not VERCEL_FRONTEND_URL:
        update.message.reply_text('Error: VERCEL_FRONTEND_URL environment variable is not set.')
        return
        
    # Telegram Mini App के लिए WebApp button
    keyboard = [[
        InlineKeyboardButton(
            "🎶 ओपन म्यूजिक प्लेयर", 
            web_app={"url": VERCEL_FRONTEND_URL}
        )
    ]]
    reply_markup = InlineKeyboardMarkup(keyboard)

    update.message.reply_text(
        'मस्त म्यूजिक सुनने के लिए प्लेयर खोलें:', 
        reply_markup=reply_markup
    )

# कमांड हैंडलर को Application में जोड़ें
application.add_handler(CommandHandler("play", start_command))

# --- Webhook Endpoint for Telegram ---

@app.route('/telegram-webhook', methods=['POST'])
async def telegram_webhook():
    """Main endpoint where Telegram sends updates and Application processes them."""
    if request.method == "POST":
        if not TELEGRAM_BOT_TOKEN:
             return 'Bot token missing', 500
             
        # Application को JSON अपडेट भेजें
        await application.process_update(
            Update.de_json(request.get_json(force=True), bot)
        )
        return 'ok'
    return abort(400)

# --- Webhook Setup Utility (One-time use) ---

@app.route('/set-webhook', methods=['GET'])
def set_webhook():
    """Sets the Telegram Webhook to point to the Render URL."""
    if not RENDER_EXTERNAL_URL:
        return jsonify({'status': 'error', 'message': 'RENDER_EXTERNAL_URL not set.'}), 500

    webhook_url = f'{RENDER_EXTERNAL_URL}/telegram-webhook'
    
    try:
        # Webhook सेट करें
        s = bot.set_webhook(url=webhook_url)
        if s:
            return jsonify({'status': 'success', 'message': f'Webhook successfully set to {webhook_url}'})
        else:
            return jsonify({'status': 'error', 'message': 'Telegram API call to set Webhook failed.'}), 500
    except Exception as e:
        logger.error(f"Error setting webhook: {e}")
        return jsonify({'status': 'error', 'message': f'Exception during webhook setup: {e}'}), 500


# --- Audio Streaming Endpoint ---

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
            # Full file download (Fallback)
            return send_file(MUSIC_FILE_PATH, mimetype='audio/mpeg')

        # Parse Range header for partial content streaming
        byte_range = range_header.replace('bytes=', '').split('-')
        start_byte = int(byte_range[0])
        chunk_size = 1024 * 512  # 512KB chunk size
        end_byte = min(start_byte + chunk_size, file_size - 1)
        
        content_range = f'bytes {start_byte}-{end_byte}/{file_size}'
        
        # Read the specific bytes
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
    """Render के Sleep से बचाने के लिए हेल्थ चेक एंडपॉइंट"""
    return "Bot is awake and streaming service is running!", 200

# --- Main App Run ---

if __name__ == '__main__':
    # Render environment में पोर्ट वेरिएबल का उपयोग करें
    port = int(os.environ.get('PORT', 5000))
    # Webhook mode में, एप्लीकेशन को background में स्टार्ट करने की आवश्यकता नहीं होती
    app.run(host='0.0.0.0', port=port)
