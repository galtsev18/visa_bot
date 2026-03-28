import { createMonitorContext } from '../composition/createMonitorContext';
import { UserBotManager } from '../lib/userBotManager';
import { logger } from '../lib/logger';
import { formatMonitorProcessStarted } from '../lib/telegram';
import { isSocketHangupError, formatErrorForLog } from '../lib/utils';
import { pollUntilActiveUsersFromSheets } from './pollUntilActiveUsers';

const COOLDOWN = 3600; // 1 hour in seconds
/** Minimum interval between "quota exceeded" Telegram messages (ms). */
const QUOTA_EXCEEDED_DEBOUNCE_MS = 10 * 60 * 1000; // 10 minutes

export interface MonitorCommandOptions {
  refreshInterval?: string | number;
  sheetsRefresh?: string | number;
}

export async function monitorCommand(options: MonitorCommandOptions = {}): Promise<never> {
  try {
    const ctx = await createMonitorContext({
      refreshInterval: options.refreshInterval ? Number(options.refreshInterval) : undefined,
      sheetsRefresh: options.sheetsRefresh ? Number(options.sheetsRefresh) : undefined,
    });

    const { config, repo, dateCache, notifications } = ctx;
    let { users, cacheEntries } = ctx;
    const managerDeps = { repo, dateCache, notifications };

    let lastQuotaExceededSent = 0;
    repo.setQuotaNotifier?.((event: 'exceeded' | 'resolved') => {
      if (event === 'exceeded') {
        const now = Date.now();
        if (now - lastQuotaExceededSent < QUOTA_EXCEEDED_DEBOUNCE_MS) return;
        lastQuotaExceededSent = now;
      }
      const msg =
        event === 'exceeded'
          ? '⚠️ <b>Google Sheets quota exceeded</b>. Retrying in ~1 min…'
          : '✅ <b>Google Sheets restored</b>. Operations resumed.';
      notifications.send(msg, config.telegramManagerChatId ?? '').catch((err) => {
        logger.error(`Failed to send quota notification: ${formatErrorForLog(err)}`);
      });
    });

    logger.info('Initializing multi-user monitoring system...');
    logger.info(`Refresh interval: ${config.refreshInterval}s`);
    logger.info(`Sheets refresh interval: ${config.sheetsRefreshInterval}s`);
    logger.info(`Cache TTL: ${config.cacheTtl}s`);
    logger.info(`Rotation cooldown: ${config.rotationCooldown}s`);

    const polled = await pollUntilActiveUsersFromSheets(config, repo, dateCache, {
      users,
      cacheEntries,
    });
    users = polled.users;
    cacheEntries = polled.cacheEntries;

    logger.info(`Found ${users.length} active users`);

    const chatId = String(config.telegramManagerChatId ?? '').trim();
    if (chatId) {
      const earlyOk = await notifications.send(formatMonitorProcessStarted(users.length), chatId);
      if (!earlyOk) {
        logger.warn(
          'Telegram: "process started" notification was not delivered (check token, chat_id, journal for Telegram send errors)'
        );
      }
    }

    const manager = new UserBotManager(config, managerDeps);
    await manager.initializeUsers(users);

    logger.info('Starting monitoring loop...');
    await manager.monitorWithRotation(cacheEntries);
  } catch (err) {
    const errMsg = formatErrorForLog(err);
    if (isSocketHangupError(err)) {
      logger.info(`Socket hangup error: ${errMsg}. Trying again after ${COOLDOWN} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN * 1000));
      return monitorCommand(options);
    } else {
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error({ err, stack }, `Error: ${errMsg}`);
      if (process.env.NODE_ENV !== 'production' && stack) {
        logger.debug({ stack }, 'Stack trace');
      }
      process.exit(1);
    }
  }
  throw new Error('Unreachable');
}
