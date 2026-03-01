/**
 * Use case: check a user for an available date using shared cache.
 * Refreshes cache when stale, filters by user's date validity, returns earliest valid date or null.
 */
import type { CheckUserUser, CheckUserWithCacheDeps } from './types.js';

export async function checkUserWithCache(
  user: CheckUserUser,
  deps: CheckUserWithCacheDeps
): Promise<string | null> {
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
    const parts: string[] = [];
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
      const errMsg =
        error instanceof Error ? error.message : String(error);
      log(`Failed to refresh cache: ${errMsg}`);
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
