import { getConfig, validateEnvForSheets, validateMultiUserConfig } from '../lib/config.js';
import {
  initializeSheets,
  getInitialData,
  readUsers,
  readSettingsFromSheet,
  setSheetsQuotaNotifier,
} from '../lib/sheets.js';
import { initializeTelegram, sendNotification } from '../lib/telegram.js';
import { UserBotManager } from '../lib/userBotManager.js';
import { log, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds

export async function monitorCommand(options = {}) {
  const config = getConfig();

  // Only require .env vars needed to open the spreadsheet (Settings sheet may not exist yet)
  validateEnvForSheets(config);

  try {
    await initializeSheets(config.googleCredentialsPath, config.googleSheetsId);
    log('Google Sheets initialized');

    // Read Settings (creates Settings sheet + default rows if missing)
    const sheetSettings = await readSettingsFromSheet();
    delete sheetSettings.googleSheetsId;
    delete sheetSettings.googleCredentialsPath;
    Object.assign(config, sheetSettings);

    // Now require full config (Telegram etc. from sheet or .env)
    validateMultiUserConfig(config);

    if (options.refreshInterval) config.refreshInterval = Number(options.refreshInterval);
    if (options.sheetsRefresh) config.sheetsRefreshInterval = Number(options.sheetsRefresh);

    log('Initializing multi-user monitoring system...');
    log(`Refresh interval: ${config.refreshInterval}s`);
    log(`Sheets refresh interval: ${config.sheetsRefreshInterval}s`);
    log(`Cache TTL: ${config.cacheTtl}s`);
    log(`Rotation cooldown: ${config.rotationCooldown}s`);

    initializeTelegram(config.telegramBotToken, config.telegramManagerChatId);
    log('Telegram initialized');

    setSheetsQuotaNotifier((event) => {
      const msg =
        event === 'exceeded'
          ? '⚠️ <b>Google Sheets quota exceeded</b>. Retrying in ~1 min…'
          : '✅ <b>Google Sheets quota restored</b>. Operations resumed.';
      sendNotification(msg, config.telegramManagerChatId);
    });

    // Single batch read: users + cache (1 read instead of 2)
    const { users, cacheEntries } = await getInitialData();

    if (users.length === 0) {
      log('No active users found in Google Sheets');
      process.exit(1);
    }

    log(`Found ${users.length} active users`);

    const manager = new UserBotManager(config);
    await manager.initializeUsers(users);

    log('Starting monitoring loop...');
    await manager.monitorWithRotation(cacheEntries);
  } catch (err) {
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN * 1000));
      return monitorCommand(options);
    } else {
      log(`Error: ${err.message}`);
      log(err.stack);
      process.exit(1);
    }
  }
}
