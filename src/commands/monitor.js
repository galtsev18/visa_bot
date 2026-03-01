import { createMonitorContext } from '../composition/createMonitorContext.js';
import { initializeTelegram, sendNotification } from '../lib/telegram.js';
import { setSheetsQuotaNotifier } from '../lib/sheets.js';
import { UserBotManager } from '../lib/userBotManager.js';
import { logger } from '../lib/logger.js';
import { log, isSocketHangupError, formatErrorForLog } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds

export async function monitorCommand(options = {}) {
  try {
    const ctx = await createMonitorContext({
      refreshInterval: options.refreshInterval ? Number(options.refreshInterval) : undefined,
      sheetsRefresh: options.sheetsRefresh ? Number(options.sheetsRefresh) : undefined,
    });

    const { config, users, cacheEntries, repo, dateCache, notifications } = ctx;
    const managerDeps = { repo, dateCache, notifications };

    // Quota notifications: lib/telegram and lib/sheets still used for global notifier
    initializeTelegram(config.telegramBotToken, config.telegramManagerChatId);
    setSheetsQuotaNotifier((event) => {
      const msg =
        event === 'exceeded'
          ? '⚠️ <b>Google Sheets quota exceeded</b>. Retrying in ~1 min…'
          : '✅ <b>Google Sheets quota restored</b>. Operations resumed.';
      sendNotification(msg, config.telegramManagerChatId).catch((err) => {
        log(`Failed to send quota notification: ${formatErrorForLog(err)}`);
      });
    });

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

    const manager = new UserBotManager(config, managerDeps);
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
