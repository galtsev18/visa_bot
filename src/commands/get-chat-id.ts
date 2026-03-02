import { logger } from '../lib/logger';
import { getConfig } from '../lib/config';
import { initializeSheets, readSettingsFromSheet } from '../lib/sheets';
import { formatErrorForLog } from '../lib/utils';
import type { EnvConfig } from '../lib/config';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type?: string; title?: string; first_name?: string };
    text?: string;
  };
}

async function getUpdates(
  token: string,
  offset = 0,
  timeout = 30
): Promise<TelegramUpdate[]> {
  const url = `${TELEGRAM_API}/bot${token}/getUpdates?limit=5&timeout=${timeout}&offset=${offset}`;
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: TelegramUpdate[];
  };
  if (!data.ok) {
    const err = new Error(data.description ?? `HTTP ${res.status}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = (res as { status: number }).status;
    throw err;
  }
  return data.result ?? [];
}

async function ensureTelegramConfig(
  config: EnvConfig & { telegramBotToken?: string }
): Promise<EnvConfig & { telegramBotToken?: string }> {
  if (config.telegramBotToken) return config;
  if (!config.googleSheetsId || !config.googleCredentialsPath) return config;
  try {
    await initializeSheets(config.googleCredentialsPath, config.googleSheetsId);
    const sheet = (await readSettingsFromSheet()) as { telegramBotToken?: string };
    if (sheet.telegramBotToken) {
      config.telegramBotToken = sheet.telegramBotToken;
      logger.info('Using TELEGRAM_BOT_TOKEN from Settings sheet');
    }
  } catch (e) {
    logger.error(`Could not load Settings sheet: ${formatErrorForLog(e)}`);
  }
  return config;
}

export async function getChatIdCommand(): Promise<never> {
  const config = await ensureTelegramConfig(getConfig());

  if (!config.telegramBotToken) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not set.');
    console.error(
      'Set it in .env or in the Google Sheet "Settings" tab (key: TELEGRAM_BOT_TOKEN, value: your token).'
    );
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
    console.error(
      '\nSet TELEGRAM_BOT_TOKEN in .env or in the Settings sheet (format: 123456789:ABCdef...)'
    );
    process.exit(1);
  }

  try {
    logger.info('Connecting to Telegram bot...');
    logger.info(`Using bot token: ${cleanToken.substring(0, 10)}...`);

    let updates = await getUpdates(cleanToken, 0, 0);
    logger.info('Bot token is valid!');

    if (updates.length > 0) {
      const last = updates[updates.length - 1];
      if (last.message) {
        const chatId = last.message.chat.id;
        const chatType = last.message.chat.type ?? '';
        const chatTitle =
          last.message.chat.title ?? last.message.chat.first_name ?? 'Unknown';
        logger.info('\n✅ Found chat ID from last message:');
        logger.info(`Chat ID: ${chatId}`);
        logger.info(`Chat Type: ${chatType}`);
        logger.info(`Chat Name: ${chatTitle}`);
        logger.info('\n✅ Your Telegram Manager Chat ID is:');
        console.logger.info(`\n${'='.repeat(50)}`);
        console.logger.info(`TELEGRAM_MANAGER_CHAT_ID=${chatId}`);
        console.logger.info(`${'='.repeat(50)}\n`);
        logger.info(
          'Copy this value to your .env or to the Settings sheet (key: TELEGRAM_MANAGER_CHAT_ID).'
        );
        process.exit(0);
      }
    }

    logger.info('No previous messages found. Starting to listen for new messages...');
    logger.info('Please send a message to your bot now, and I will extract the chat ID.');
    logger.info('Press Ctrl+C to stop after sending a message.');

    let offset = updates.length ? updates[updates.length - 1].update_id + 1 : 0;
    let lastChatId: number | null = null;
    let messageCount = 0;

    const poll = async (): Promise<void> => {
      try {
        updates = await getUpdates(cleanToken, offset, 25);
        for (const u of updates) {
          offset = u.update_id + 1;
          if (!u.message) continue;
          messageCount++;
          lastChatId = u.message.chat.id;
          const chatType = u.message.chat.type ?? '';
          const chatTitle =
            u.message.chat.title ?? u.message.chat.first_name ?? 'Unknown';
          logger.info(`\n=== Message #${messageCount} received ===`);
          logger.info(`Chat ID: ${lastChatId}`);
          logger.info(`Chat Type: ${chatType}`);
          logger.info(`Chat Name: ${chatTitle}`);
          logger.info(`Message: ${u.message.text ?? '(no text)'}`);
          logger.info('\n✅ Your Telegram Manager Chat ID is:');
          console.logger.info(`\n${'='.repeat(50)}`);
          console.logger.info(`TELEGRAM_MANAGER_CHAT_ID=${lastChatId}`);
          console.logger.info(`${'='.repeat(50)}\n`);
          logger.info(
            'Copy this value to your .env or to the Settings sheet (key: TELEGRAM_MANAGER_CHAT_ID).'
          );
          logger.info('Press Ctrl+C to exit');
        }
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        if (e.statusCode === 404) {
          console.error('\n❌ Error: Bot token is invalid or bot not found');
          console.error('Verify TELEGRAM_BOT_TOKEN in .env or in the Settings sheet.');
          process.exit(1);
        }
        logger.error(`Polling error: ${formatErrorForLog(err)}`);
      }
      setTimeout(poll, 500);
    };

    const onExit = (): never => {
      logger.info('\nStopping...');
      if (lastChatId !== null) {
        logger.info(`\nLast chat ID found: ${lastChatId}`);
        logger.info('Add to .env or Settings sheet:');
        console.logger.info(`TELEGRAM_MANAGER_CHAT_ID=${lastChatId}`);
      } else {
        logger.info('No messages received. Send a message to your bot and try again.');
      }
      process.exit(0);
    };

    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
    poll();
  } catch (error) {
    const e = error as Error & { statusCode?: number };
    console.error(`\n❌ Error: ${formatErrorForLog(error)}`);
    if (e.statusCode === 404) {
      console.error('\n❌ Bot token is invalid or bot not found');
      console.error(
        'Verify TELEGRAM_BOT_TOKEN in .env or Settings sheet and get a token from @BotFather'
      );
    } else {
      console.error('\nTroubleshooting:');
      console.error('1. Set TELEGRAM_BOT_TOKEN in .env or in the Settings sheet');
      console.error('2. Verify the token with @BotFather on Telegram');
      console.error('3. Make sure the bot is active and not deleted');
    }
    process.exit(1);
  }
  throw new Error('Unreachable');
}
