/**
 * Use case: start monitor — initialize date cache and send "Monitor started" notification.
 *
 * @param {Array|undefined} initialCacheEntries - Optional preloaded cache entries (e.g. from getInitialData)
 * @param {Object} deps - Dependencies: initializeCache, getCacheStats, formatMonitorStarted, sendNotification, users, config
 * @returns {Promise<void>}
 */
export async function startMonitor(initialCacheEntries, deps) {
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
  await sendNotification(startedMsg, config.telegramManagerChatId);
}
