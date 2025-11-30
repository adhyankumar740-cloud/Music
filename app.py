import os
import requests
import json
from flask import Flask, send_file, request, jsonify, abort
from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Dispatcher, CommandHandler, CallbackContext
from io import BytesIO

# --- Configuration (Set these as Environment Variables on Render) ---
# ⚠️ इन्हें Render Settings -> Environment में सेट करें
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN') # @BotFather से प्राप्त टोकन
VERCEL_FRONTEND_URL = os.environ.get('VERCEL_FRONTEND_URL') # आपके Vercel App का URL
RENDER_EXTERNAL_URL = os.environ.get('RENDER_EXTERNAL_URL') # Render द्वारा दिया गया आपका URL

# --- Flask App Setup ---
app = Flask(__name__)
bot = Bot(token=TELEGRAM_BOT_TOKEN)
dispatcher = Dispatcher(bot, None, use_context=True)

# --- Music File Path ---
# सुनिश्चित करें कि आपके प्रोजेक्ट में 'music' फ़ोल्डर के अंदर 'sample.mp3' फ़ाइल मौजूद है।
MUSIC_FILE_PATH = "Tum Hi Ho (From Aashiqui 2).mp3" 

# --- Telegram Command Handler ---

def start_command(update: Update, context: CallbackContext):
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

dispatcher.add_handler(CommandHandler("play", start_command))

# --- Webhook Endpoint for Telegram ---

@app.route('/telegram-webhook', methods=['POST'])
def telegram_webhook():
    """Main endpoint where Telegram sends updates."""
    if request.method == "POST":
        update = Update.de_json(request.get_json(force=True), bot)
        # Dispatcher अपडेट को हैंडल करता है
        dispatcher.process_update(update)
        return 'ok'
    return abort(400)

# --- Webhook Setup Utility ---

@app.route('/set-webhook', methods=['GET', 'POST'])
def set_webhook():
    """Sets the Telegram Webhook to point to the Render URL."""
    if not RENDER_EXTERNAL_URL:
        return jsonify({'status': 'error', 'message': 'RENDER_EXTERNAL_URL not set.'}), 500

    webhook_url = f'{RENDER_EXTERNAL_URL}/telegram-webhook'
    s = bot.set_webhook(webhook_url)

    if s:
        return jsonify({'status': 'success', 'message': f'Webhook set to {webhook_url}'})
    else:
        return jsonify({'status': 'error', 'message': 'Webhook setup failed.'}), 500

# --- Audio Streaming Endpoint (Same as before) ---

@app.route('/stream-audio')
def stream_audio():
    """Streams the audio file with range headers for seeking."""
    try:
        if not os.path.exists(MUSIC_FILE_PATH):
            return "Music file not found", 404

        range_header = request.headers.get('Range', None)
        file_size = os.path.getsize(MUSIC_FILE_PATH)
        
        # Simple download if Range header is missing
        if not range_header:
            return send_file(MUSIC_FILE_PATH, mimetype='audio/mpeg')

        # Parse Range header for partial content
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
        
        return data, 206, headers # 206 Partial Content
        
    except Exception as e:
        app.logger.error(f"Streaming error: {e}")
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
    app.run(host='0.0.0.0', port=port)
