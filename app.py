import os
import logging
import asyncio 
from typing import Optional

from flask import Flask, request, jsonify, abort 
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler, filters, 
    ContextTypes, Application
)
from dotenv import load_dotenv
import requests 

# Load environment variables
load_dotenv()

# --- Logging Setup ---
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# --- Configuration (Environment Variables) ---
TELEGRAM_BOT_TOKEN: Optional[str] = os.getenv("TELEGRAM_BOT_TOKEN")
RENDER_FRONTEND_URL: Optional[str] = os.getenv('RENDER_FRONTEND_URL') 
RENDER_EXTERNAL_URL: Optional[str] = os.getenv("RENDER_EXTERNAL_URL") 
YOUTUBE_API_KEY: Optional[str] = os.getenv("YOUTUBE_API_KEY") 

WEBHOOK_PATH = f'/webhook/{TELEGRAM_BOT_TOKEN}' if TELEGRAM_BOT_TOKEN else '/webhook/dummy_token'

# --- Global Objects ---
app = Flask(__name__)
application: Optional[Application] = None

# --- BOT HANDLERS ---
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Welcome! Type `/play` to start the group music player.")

async def play_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not RENDER_FRONTEND_URL:
        await update.message.reply_text('Error: RENDER_FRONTEND_URL environment variable is not set.')
        return
        
    chat_id = update.effective_chat.id
    player_url = f"{RENDER_FRONTEND_URL}?chat_id={chat_id}&mode=search"
    keyboard = [[InlineKeyboardButton("▶️ Search and Play Group Music", web_app={"url": player_url})]]
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

# --- PTB Initialization ---
async def initialize_ptb_application():
    global application
    if application: return
    
    if not TELEGRAM_BOT_TOKEN or not RENDER_EXTERNAL_URL: 
        logger.critical("CRITICAL: TOKEN or URL is missing! Cannot initialize bot.")
        return

    app_builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    application = app_builder.build()
    setup_handlers(application)
    
    webhook_url = f'{RENDER_EXTERNAL_URL}{WEBHOOK_PATH}'
    await application.initialize() 
    
    success = await application.bot.set_webhook(url=webhook_url)
    if success:
        logger.info(f"Auto-Webhook successfully set to {webhook_url}")
    else:
        logger.error("Auto-Webhook setting failed.")
    
    await application.start() 
    logger.info("PTB Application started successfully.")

# --- WEBHOOK ENDPOINT (The Clean Async Fix) ---
@app.route(WEBHOOK_PATH, methods=['POST'])
async def telegram_webhook(): 
    if not application:
        # Check and attempt to initialize if the bot wasn't ready during startup
        await initialize_ptb_application() 
        if not application:
             return 'Bot not ready', 503

    if request.method == "POST":
        try:
            update = Update.de_json(await request.get_json(force=True), application.bot) 
            await application.process_update(update) 
            return 'ok'
        except Exception as e:
            logger.error(f"Error processing update: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Update processing failed'}), 500
    return abort(400)

# --- YOUTUBE DATA API SEARCH ENDPOINT (Synchronous, handled by Uvicorn) ---
@app.route('/search-youtube', methods=['GET'])
def search_youtube():
    query = request.args.get('q')
    if not query or not YOUTUBE_API_KEY:
        return jsonify({'error': 'Required parameters missing'}), 400

    YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
    params = {'part': 'snippet', 'q': query, 'key': YOUTUBE_API_KEY, 'type': 'video', 'maxResults': 5}
    
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

# --- SERVER STARTUP & HEALTH CHECK ---
@app.route('/')
async def health_check():
    if not application:
        await initialize_ptb_application() 
    return "Music Bot Backend is alive and ready!", 200

# IMPORTANT FIX: Removed the deprecated @app.before_first_request decorator. 
# Uvicorn (ASGI) server automatically handles startup events, and our routes 
# (like telegram_webhook and health_check) call initialize_ptb_application() if needed.

# This block is for local testing only; Uvicorn handles the production run.
if __name__ == '__main__':
    # FIX: Removed asyncio.run() here to prevent conflicts with Flask's built-in server.
    PORT = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=PORT, debug=True)
