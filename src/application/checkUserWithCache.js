/**
 * Use case: check a user for an available date using shared cache.
 * Refreshes cache when stale, filters by user's date validity, returns earliest valid date or null.
 *
 * @param {{ email: string; provider?: string; scheduleId: string; isDateValid: (date: string) => boolean }} user
 * @param {{
 *   bot: { client: { checkAvailableDate: Function; checkAvailableTime: Function } } | null;
 *   sessionHeaders: Record<string, unknown> | null;
 *   config: { cacheTtl: number; facilityId: number; aisRequestDelaySec?: number; aisRateLimitBackoffSec?: number };
 *   getAvailableDates: (provider: string) => string[];
 *   isCacheStale: (date: string, ttl: number, provider: string) => boolean;
 *   refreshAllDates: (client: unknown, headers: unknown, scheduleId: string, facilityId: number, ttl: number, provider: string, opts?: unknown) => Promise<string[]>;
 *   isDateAvailable: (date: string, provider: string) => boolean;
 *   log: (msg: string) => void;
 * }} deps
 * @returns {Promise<string|null>} - YYYY-MM-DD or null
 */
export async function checkUserWithCache(user, deps) {
  const {
    bot,
    sessionHeaders,
    config,
    getAvailableDates,
    isCacheStale,
    refreshAllDates,
    isDateAvailable,
    log,
  } = deps;

  if (!bot || !sessionHeaders) {
    const parts = [];
    if (!bot) parts.push('bot not initialized');
    if (!sessionHeaders) parts.push('session not initialized (not logged in)');
    log(
      `User ${user.email}: ${parts.join(', ')} — skipping date check (login may have failed at startup)`
    );
    return null;
  }

  const provider = user.provider || 'ais';
  const availableDates = getAvailableDates(provider);

  let datesToUse = [...availableDates];
  if (
    availableDates.length === 0 ||
    availableDates.some((date) => isCacheStale(date, config.cacheTtl, provider))
  ) {
    log(`Refreshing date cache for user ${user.email} (${provider})...`);
    try {
      await refreshAllDates(
        bot.client,
        sessionHeaders,
        user.scheduleId,
        config.facilityId,
        config.cacheTtl,
        provider,
        {
          requestDelaySec: config.aisRequestDelaySec,
          rateLimitBackoffSec: config.aisRateLimitBackoffSec,
        }
      );
      datesToUse = getAvailableDates(provider);
    } catch (error) {
      const errMsg = error?.message ?? String(error);
      log(`Failed to refresh cache: ${errMsg}`);
      // Keep using existing datesToUse (stale) like original
    }
  }

  const validDates = datesToUse.filter((date) => {
    if (!user.isDateValid(date)) return false;
    return isDateAvailable(date, provider);
  });

  if (validDates.length === 0) {
    log(`No valid dates found for user ${user.email}`);
    return null;
  }

  validDates.sort();
  const selectedDate = validDates[0];
  log(`Found valid date ${selectedDate} for user ${user.email}`);
  return selectedDate;
}
