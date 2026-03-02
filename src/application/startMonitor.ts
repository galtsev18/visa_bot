/**
 * Use case: start monitor — initialize date cache and send "Monitor started" notification.
 */
import type { CacheEntry, StartMonitorDeps } from './types';

export async function startMonitor(
  initialCacheEntries: CacheEntry[] | undefined,
  deps: StartMonitorDeps
): Promise<void> {
  const {
    initializeCache,
    getCacheStats,
    formatMonitorStarted,
    sendNotification,
    users,
    config,
  } = deps;

  await initializeCache(initialCacheEntries);

  const cacheStats = getCacheStats();
  const startedMsg = formatMonitorStarted(users, config, cacheStats);
  await sendNotification(startedMsg, config.telegramManagerChatId ?? '');
}
