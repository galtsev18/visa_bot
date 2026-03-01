import TelegramBot from 'node-telegram-bot-api';
import { getConfig } from '../lib/config.js';
import { log } from '../lib/utils.js';

export async function getChatIdCommand() {
  const config = getConfig();

  if (!config.telegramBotToken) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not set in .env file');
    console.error('Please add TELEGRAM_BOT_TOKEN=your_bot_token to your .env file');
    process.exit(1);
  }

  // Clean the token (remove quotes, whitespace)
  const cleanToken = config.telegramBotToken.trim().replace(/^["']|["']$/g, '');
  
  // Validate token format (should be numbers:letters format)
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(cleanToken)) {
    console.error('Error: Invalid bot token format');
    console.error(`Received token (first 20 chars): ${cleanToken.substring(0, 20)}...`);
    console.error('Bot token should be in format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    console.error('Common issues:');
    console.error('  - Token has extra quotes or spaces (remove them)');
    console.error('  - Token is incomplete or corrupted');
    console.error('  - Get a fresh token from @BotFather on Telegram');
    console.error('\nYour .env file should look like:');
    console.error('TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    console.error('(No quotes, no spaces around the = sign)');
    process.exit(1);
  }
  
  // Use cleaned token
  config.telegramBotToken = cleanToken;

  try {
    log('Connecting to Telegram bot...');
    log(`Using bot token: ${config.telegramBotToken.substring(0, 10)}...`);
    
    // First, try to get updates to verify the token works
    const bot = new TelegramBot(config.telegramBotToken);
    
    try {
      const updates = await bot.getUpdates({ limit: 1 });
      log('Bot token is valid!');
      
      if (updates.length > 0) {
        const lastUpdate = updates[updates.length - 1];
        if (lastUpdate.message) {
          const chatId = lastUpdate.message.chat.id;
          const chatType = lastUpdate.message.chat.type;
          const chatTitle = lastUpdate.message.chat.title || lastUpdate.message.chat.first_name || 'Unknown';
          
          log('\n✅ Found chat ID from last message:');
          log(`Chat ID: ${chatId}`);
          log(`Chat Type: ${chatType}`);
          log(`Chat Name: ${chatTitle}`);
          log('\n✅ Your Telegram Manager Chat ID is:');
          console.log(`\n${'='.repeat(50)}`);
          console.log(`TELEGRAM_MANAGER_CHAT_ID=${chatId}`);
          console.log(`${'='.repeat(50)}\n`);
          log('You can now copy this value to your .env file');
          process.exit(0);
        }
      }
    } catch (error) {
      if (error.response && error.response.statusCode === 404) {
        console.error('\n❌ Error: Bot token is invalid or bot not found');
        console.error('Please verify:');
        console.error('1. Your bot token is correct (get it from @BotFather)');
        console.error('2. The token is properly set in your .env file');
        console.error('3. The bot exists and is active');
        process.exit(1);
      }
      throw error;
    }

    // If no previous messages, start polling for new ones
    log('No previous messages found. Starting to listen for new messages...');
    log('Please send a message to your bot now, and I will extract the chat ID.');
    log('Press Ctrl+C to stop after sending a message.');

    const pollingBot = new TelegramBot(config.telegramBotToken, { polling: true });
    let lastChatId = null;
    let messageCount = 0;

    pollingBot.on('message', (msg) => {
      messageCount++;
      lastChatId = msg.chat.id;
      const chatType = msg.chat.type;
      const chatTitle = msg.chat.title || msg.chat.first_name || 'Unknown';

      log(`\n=== Message #${messageCount} received ===`);
      log(`Chat ID: ${lastChatId}`);
      log(`Chat Type: ${chatType}`);
      log(`Chat Name: ${chatTitle}`);
      log(`Message: ${msg.text || '(no text)'}`);
      log('\n✅ Your Telegram Manager Chat ID is:');
      console.log(`\n${'='.repeat(50)}`);
      console.log(`TELEGRAM_MANAGER_CHAT_ID=${lastChatId}`);
      console.log(`${'='.repeat(50)}\n`);
      log('You can now copy this value to your .env file');
      log('Press Ctrl+C to exit');
    });

    // Handle polling errors
    pollingBot.on('polling_error', (error) => {
      if (error.response && error.response.statusCode === 404) {
        console.error('\n❌ Error: Bot token is invalid or bot not found');
        console.error('Please verify your TELEGRAM_BOT_TOKEN in .env file');
        console.error('Get a new token from @BotFather on Telegram if needed');
        pollingBot.stopPolling();
        process.exit(1);
      } else {
        log(`Polling error: ${error.message}`);
      }
    });

    // Keep the process alive
    process.on('SIGINT', () => {
      log('\nStopping bot...');
      pollingBot.stopPolling();
      if (lastChatId) {
        log(`\nLast chat ID found: ${lastChatId}`);
        log('Add this to your .env file:');
        console.log(`TELEGRAM_MANAGER_CHAT_ID=${lastChatId}`);
      } else {
        log('No messages received. Please send a message to your bot and try again.');
      }
      process.exit(0);
    });

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.response) {
      console.error('Telegram API Error:', error.response.body || error.response);
    }
    console.error('\nTroubleshooting:');
    console.error('1. Check that TELEGRAM_BOT_TOKEN is set correctly in .env');
    console.error('2. Verify the token with @BotFather on Telegram');
    console.error('3. Make sure the bot is active and not deleted');
    process.exit(1);
  }
}
