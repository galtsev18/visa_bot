/**
 * Use case: start monitor — initialize date cache and send "Monitor started" notification.
 *
 * @param {Array<{ provider?: string; date: string; available?: boolean; times_available?: string[] }> | undefined} initialCacheEntries - Preloaded cache entries (e.g. from getInitialData)
 * @param {{
 *   initializeCache: (entries: unknown) => Promise<void>;
 *   getCacheStats: () => { total: number; providers: Record<string, { entries: number; available: number }> };
 *   formatMonitorStarted: (users: unknown[], config: { telegramManagerChatId?: string }, stats: unknown) => string;
 *   sendNotification: (msg: string, chatId: string) => Promise<unknown>;
 *   users: unknown[];
 *   config: { telegramManagerChatId?: string };
 * }} deps
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
