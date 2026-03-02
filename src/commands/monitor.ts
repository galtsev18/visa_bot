import { createMonitorContext } from '../composition/createMonitorContext';
import { UserBotManager } from '../lib/userBotManager';
import { logger } from '../lib/logger';
import { isSocketHangupError, formatErrorForLog } from '../lib/utils';

const COOLDOWN = 3600; // 1 hour in seconds

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

    const { config, users, cacheEntries, repo, dateCache, notifications } = ctx;
    const managerDeps = { repo, dateCache, notifications };

    repo.setQuotaNotifier((event) => {
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

    if (users.length === 0) {
      logger.info('No active users found in Google Sheets');
      process.exit(1);
    }

    logger.info(`Found ${users.length} active users`);

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
      logger.error({ err }, `Error: ${errMsg}`);
      const e = err as { stack?: string };
      if (process.env.NODE_ENV !== 'production' && e?.stack) {
        logger.debug({ stack: e.stack }, 'Stack trace');
      }
      process.exit(1);
    }
  }
  throw new Error('Unreachable');
}
