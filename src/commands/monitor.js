import { getConfig, validateEnvForSheets, validateMultiUserConfig } from '../lib/config.js';
import {
  initializeSheets,
  getInitialData,
  readSettingsFromSheet,
  setSheetsQuotaNotifier,
} from '../lib/sheets.js';
import { initializeTelegram, sendNotification } from '../lib/telegram.js';
import { UserBotManager } from '../lib/userBotManager.js';
import { logger } from '../lib/logger.js';
import { log, isSocketHangupError, formatErrorForLog } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds

export async function monitorCommand(options = {}) {
  try {
    // Use composition root when available (e.g. running from dist)
    let config;
    let users;
    let cacheEntries;
    let compositionModule = null;
    try {
      compositionModule = await import('../composition/createMonitorContext.js');
    } catch (err) {
      log(`Composition root not loaded (expected when running from src): ${formatErrorForLog(err)}`);
    }

    if (compositionModule?.createMonitorContext) {
      const ctx = await compositionModule.createMonitorContext({
        refreshInterval: options.refreshInterval
          ? Number(options.refreshInterval)
          : undefined,
        sheetsRefresh: options.sheetsRefresh
          ? Number(options.sheetsRefresh)
          : undefined,
      });
      config = ctx.config;
      users = ctx.users;
      cacheEntries = ctx.cacheEntries;
      log('Monitor started via composition root (adapters).');

      // Ensure global Telegram is initialized for UserBotManager's sendNotification calls
      initializeTelegram(config.telegramBotToken, config.telegramManagerChatId);
      // Register quota notifier so quota exceeded/resolved alerts are sent (same as fallback path)
      setSheetsQuotaNotifier((event) => {
        const msg =
          event === 'exceeded'
            ? '⚠️ <b>Google Sheets quota exceeded</b>. Retrying in ~1 min…'
            : '✅ <b>Google Sheets quota restored</b>. Operations resumed.';
        sendNotification(msg, config.telegramManagerChatId).catch((err) => {
          log(`Failed to send quota notification: ${formatErrorForLog(err)}`);
        });
      });
    } else {
      config = getConfig();
      validateEnvForSheets(config);
      await initializeSheets(config.googleCredentialsPath, config.googleSheetsId);
      log('Google Sheets initialized');

      const sheetSettings = await readSettingsFromSheet();
      delete sheetSettings.googleSheetsId;
      delete sheetSettings.googleCredentialsPath;
      Object.assign(config, sheetSettings);
      validateMultiUserConfig(config);

      if (options.refreshInterval)
        config.refreshInterval = Number(options.refreshInterval);
      if (options.sheetsRefresh)
        config.sheetsRefreshInterval = Number(options.sheetsRefresh);

      initializeTelegram(config.telegramBotToken, config.telegramManagerChatId);
      log('Telegram initialized');

      setSheetsQuotaNotifier((event) => {
        const msg =
          event === 'exceeded'
            ? '⚠️ <b>Google Sheets quota exceeded</b>. Retrying in ~1 min…'
            : '✅ <b>Google Sheets quota restored</b>. Operations resumed.';
        sendNotification(msg, config.telegramManagerChatId).catch((err) => {
          log(`Failed to send quota notification: ${formatErrorForLog(err)}`);
        });
      });

      const data = await getInitialData();
      users = data.users;
      cacheEntries = data.cacheEntries;
    }

    log('Initializing multi-user monitoring system...');
    log(`Refresh interval: ${config.refreshInterval}s`);
    log(`Sheets refresh interval: ${config.sheetsRefreshInterval}s`);
    log(`Cache TTL: ${config.cacheTtl}s`);
    log(`Rotation cooldown: ${config.rotationCooldown}s`);

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
    const errMsg = formatErrorForLog(err);
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${errMsg}. Trying again after ${COOLDOWN} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN * 1000));
      return monitorCommand(options);
    } else {
      logger.error({ err }, `Error: ${errMsg}`);
      if (process.env.NODE_ENV !== 'production' && err?.stack) {
        logger.debug({ stack: err.stack }, 'Stack trace');
      }
      process.exit(1);
    }
  }
}
