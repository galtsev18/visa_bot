import fetch from 'node-fetch';
import { getConfig } from '../lib/config.js';
import { initializeSheets, readSettingsFromSheet } from '../lib/sheets.js';
import { log } from '../lib/utils.js';

const TELEGRAM_API = 'https://api.telegram.org';

async function getUpdates(token, offset = 0, timeout = 30) {
  const url = `${TELEGRAM_API}/bot${token}/getUpdates?limit=5&timeout=${timeout}&offset=${offset}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error(data.description || `HTTP ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }
  return data.result || [];
}

/** Try to load Telegram token from Settings sheet when not in .env */
async function ensureTelegramConfig(config) {
  if (config.telegramBotToken) return config;
  if (!config.googleSheetsId || !config.googleCredentialsPath) return config;
  try {
    await initializeSheets(config.googleCredentialsPath, config.googleSheetsId);
    const sheet = await readSettingsFromSheet();
    if (sheet.telegramBotToken) {
      config.telegramBotToken = sheet.telegramBotToken;
      log('Using TELEGRAM_BOT_TOKEN from Settings sheet');
    }
  } catch (e) {
    log(`Could not load Settings sheet: ${e.message}`);
  }
  return config;
}

export async function getChatIdCommand() {
  const config = getConfig();
  // Fills config.telegramBotToken from Settings sheet if missing (mutates config in place)
  await ensureTelegramConfig(config);

  if (!config.telegramBotToken) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not set.');
    console.error('Set it in .env or in the Google Sheet "Settings" tab (key: TELEGRAM_BOT_TOKEN, value: your token).');
    console.error('Get a token from @BotFather on Telegram.');
    process.exit(1);
  }

  const cleanToken = config.telegramBotToken.trim().replace(/^["']|["']$/g, '');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(cleanToken)) {
    console.error('Error: Invalid bot token format');
    console.error(`Received token (first 20 chars): ${cleanToken.substring(0, 20)}...`);
    console.error('Bot token should be in format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    console.error('Common issues:');
    console.error('  - Token has extra quotes or spaces (remove them)');
    console.error('  - Token is incomplete or corrupted');
    console.error('  - Get a fresh token from @BotFather on Telegram');
    console.error('\nSet TELEGRAM_BOT_TOKEN in .env or in the Settings sheet (format: 123456789:ABCdef...)');
    process.exit(1);
  }

  try {
    log('Connecting to Telegram bot...');
    log(`Using bot token: ${cleanToken.substring(0, 10)}...`);

    let updates = await getUpdates(cleanToken, 0, 0);
    log('Bot token is valid!');

    if (updates.length > 0) {
      const last = updates[updates.length - 1];
      if (last.message) {
        const chatId = last.message.chat.id;
        const chatType = last.message.chat.type || '';
        const chatTitle = last.message.chat.title || last.message.chat.first_name || 'Unknown';
        log('\n✅ Found chat ID from last message:');
        log(`Chat ID: ${chatId}`);
        log(`Chat Type: ${chatType}`);
        log(`Chat Name: ${chatTitle}`);
        log('\n✅ Your Telegram Manager Chat ID is:');
        console.log(`\n${'='.repeat(50)}`);
        console.log(`TELEGRAM_MANAGER_CHAT_ID=${chatId}`);
        console.log(`${'='.repeat(50)}\n`);
        log('Copy this value to your .env or to the Settings sheet (key: TELEGRAM_MANAGER_CHAT_ID).');
        process.exit(0);
      }
    }

    log('No previous messages found. Starting to listen for new messages...');
    log('Please send a message to your bot now, and I will extract the chat ID.');
    log('Press Ctrl+C to stop after sending a message.');

    let offset = updates.length ? updates[updates.length - 1].update_id + 1 : 0;
    let lastChatId = null;
    let messageCount = 0;

    const poll = async () => {
      try {
        updates = await getUpdates(cleanToken, offset, 25);
        for (const u of updates) {
          offset = u.update_id + 1;
          if (!u.message) continue;
          messageCount++;
          lastChatId = u.message.chat.id;
          const chatType = u.message.chat.type || '';
          const chatTitle = u.message.chat.title || u.message.chat.first_name || 'Unknown';
          log(`\n=== Message #${messageCount} received ===`);
          log(`Chat ID: ${lastChatId}`);
          log(`Chat Type: ${chatType}`);
          log(`Chat Name: ${chatTitle}`);
          log(`Message: ${u.message.text || '(no text)'}`);
          log('\n✅ Your Telegram Manager Chat ID is:');
          console.log(`\n${'='.repeat(50)}`);
          console.log(`TELEGRAM_MANAGER_CHAT_ID=${lastChatId}`);
          console.log(`${'='.repeat(50)}\n`);
          log('Copy this value to your .env or to the Settings sheet (key: TELEGRAM_MANAGER_CHAT_ID).');
          log('Press Ctrl+C to exit');
        }
      } catch (err) {
        if (err.statusCode === 404) {
          console.error('\n❌ Error: Bot token is invalid or bot not found');
          console.error('Verify TELEGRAM_BOT_TOKEN in .env or in the Settings sheet.');
          process.exit(1);
        }
        log(`Polling error: ${err.message}`);
      }
      setTimeout(poll, 500);
    };

    const onExit = () => {
      log('\nStopping...');
      if (lastChatId) {
        log(`\nLast chat ID found: ${lastChatId}`);
        log('Add to .env or Settings sheet:');
        console.log(`TELEGRAM_MANAGER_CHAT_ID=${lastChatId}`);
      } else {
        log('No messages received. Send a message to your bot and try again.');
      }
      process.exit(0);
    };

    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
    poll();
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.statusCode === 404) {
      console.error('\n❌ Bot token is invalid or bot not found');
      console.error('Verify TELEGRAM_BOT_TOKEN in .env or Settings sheet and get a token from @BotFather');
    } else {
      console.error('\nTroubleshooting:');
      console.error('1. Set TELEGRAM_BOT_TOKEN in .env or in the Settings sheet');
      console.error('2. Verify the token with @BotFather on Telegram');
      console.error('3. Make sure the bot is active and not deleted');
    }
    process.exit(1);
  }
}
