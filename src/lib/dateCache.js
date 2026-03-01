import { log, sleep, isSocketHangupError } from './utils.js';
import { readAvailableDatesCache, updateAvailableDate } from './sheets.js';

let cache = new Map(); // key: `${provider}_${date}` -> { available, times, lastChecked, validUntil }

function cacheKey(provider, date) {
  return `${(provider || 'ais').toLowerCase()}_${date}`;
}

/**
 * Initialize cache from Google Sheets or from preloaded entries (avoids a read when used with getInitialData).
 * @param {Array} [preloadedEntries] - If provided, use these instead of reading from Sheets
 */
export async function initializeCache(preloadedEntries) {
  try {
    const cacheEntries = Array.isArray(preloadedEntries)
      ? preloadedEntries
      : await readAvailableDatesCache();

    cache.clear();
    for (const entry of cacheEntries) {
      const key = cacheKey(entry.provider || 'ais', entry.date);
      cache.set(key, {
        available: entry.available === true || entry.available === 'TRUE',
        times: entry.times_available || [],
        lastChecked: entry.last_checked ? new Date(entry.last_checked) : new Date(),
        validUntil: entry.cache_valid_until
          ? new Date(entry.cache_valid_until)
          : new Date(Date.now() + 60000),
      });
    }

    log(`Initialized cache with ${cache.size} entries`);
  } catch (error) {
    log(`Failed to initialize cache: ${error.message}`);
  }
}

/**
 * Get available dates from cache for a provider
 * @param {string} [provider='ais']
 * @returns {Array<string>} - Array of available dates (YYYY-MM-DD)
 */
export function getAvailableDates(provider = 'ais') {
  const now = new Date();
  const prefix = `${(provider || 'ais').toLowerCase()}_`;
  const availableDates = [];

  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (entry.available && entry.validUntil > now) {
      availableDates.push(key.slice(prefix.length));
    }
  }

  return availableDates.sort();
}

/**
 * Check if a date is in the cache for provider
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {string} [provider='ais']
 */
export function isDateCached(date, provider = 'ais') {
  return cache.has(cacheKey(provider, date));
}

/**
 * Check if a cached date is available
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {string} [provider='ais']
 */
export function isDateAvailable(date, provider = 'ais') {
  const entry = cache.get(cacheKey(provider, date));
  if (!entry) return false;
  const now = new Date();
  if (entry.validUntil <= now) return false;
  return entry.available === true;
}

/**
 * Get available times for a date from cache
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {string} [provider='ais']
 */
export function getAvailableTimes(date, provider = 'ais') {
  const entry = cache.get(cacheKey(provider, date));
  if (!entry) return [];
  const now = new Date();
  if (entry.validUntil <= now) return [];
  return entry.times || [];
}

/**
 * Check if cache entry is stale
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {number} ttl - Time-to-live in seconds
 * @param {string} [provider='ais']
 */
export function isCacheStale(date, ttl = 60, provider = 'ais') {
  const entry = cache.get(cacheKey(provider, date));
  if (!entry) return true;
  const now = new Date();
  const age = (now - entry.lastChecked) / 1000;
  return age > ttl || entry.validUntil <= now;
}

/**
 * Update cache entry
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {boolean} available - Is date available
 * @param {Array<string>} times - Available time slots
 * @param {number} ttl - Time-to-live in seconds
 * @param {string} [provider='ais']
 */
export function updateDate(date, available, times = [], ttl = 60, provider = 'ais') {
  const now = new Date();
  const validUntil = new Date(now.getTime() + ttl * 1000);
  const key = cacheKey(provider, date);
  cache.set(key, {
    available,
    times,
    lastChecked: now,
    validUntil,
  });

  updateAvailableDate(date, available, times).catch((err) => {
    log(`Failed to update cache in Sheets for ${date}: ${err.message}`);
  });
}

/**
 * Get stale dates that need refresh
 * @param {number} ttl - Time-to-live in seconds
 * @param {string} [provider='ais']
 * @returns {Array<string>}
 */
export function getStaleDates(ttl = 60, provider = 'ais') {
  const prefix = `${(provider || 'ais').toLowerCase()}_`;
  const staleDates = [];
  const now = new Date();

  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith(prefix)) continue;
    const age = (now - entry.lastChecked) / 1000;
    if (age > ttl || entry.validUntil <= now) {
      staleDates.push(key.slice(prefix.length));
    }
  }

  return staleDates;
}

/**
 * Get cache statistics for reporting (e.g. Telegram "monitor started").
 * @returns {{ total: number, providers: Record<string, { entries: number, available: number }> }}
 */
export function getCacheStats() {
  const now = new Date();
  const providers = {};
  for (const [key, entry] of cache.entries()) {
    const sep = key.indexOf('_');
    const provider = sep >= 0 ? key.slice(0, sep) : 'ais';
    if (!providers[provider]) {
      providers[provider] = { entries: 0, available: 0 };
    }
    providers[provider].entries += 1;
    if (entry.available && entry.validUntil > now) {
      providers[provider].available += 1;
    }
  }
  return { total: cache.size, providers };
}

/**
 * Refresh a date from API and update cache
 * @param {string} date - Date to refresh
 * @param {Object} client - Client with checkAvailableTime
 * @param {Object} headers - Session headers
 * @param {string} scheduleId - Schedule ID
 * @param {number} facilityId - Facility ID
 * @param {number} ttl - Cache TTL in seconds
 * @param {string} [provider='ais']
 * @param {{ rateLimitBackoffSec?: number }} [options] - When socket hang up (rate limit), wait this many sec before retry
 * @returns {Promise<Object>} - { available, times }
 */
export async function refreshDate(
  date,
  client,
  headers,
  scheduleId,
  facilityId,
  ttl = 60,
  provider = 'ais',
  options = {}
) {
  const rateLimitBackoffSec = options.rateLimitBackoffSec ?? 30;

  const tryFetch = async () => {
    const time = await client.checkAvailableTime(headers, scheduleId, facilityId, date);
    const available = time !== null && time !== undefined;
    const times = available ? [time] : [];
    updateDate(date, available, times, ttl, provider);
    log(`Refreshed cache for date ${date}: available=${available}`);
    return { available, times };
  };

  try {
    return await tryFetch();
  } catch (error) {
    if (isSocketHangupError(error)) {
      log(
        `Rate limit / socket hang up for date ${date}, backing off ${rateLimitBackoffSec}s before retry...`
      );
      await sleep(rateLimitBackoffSec);
      try {
        return await tryFetch();
      } catch (retryErr) {
        log(`Failed to refresh date ${date} (after retry): ${retryErr.message}`);
        updateDate(date, false, [], ttl, provider);
        return { available: false, times: [] };
      }
    }
    log(`Failed to refresh date ${date}: ${error.message}`);
    updateDate(date, false, [], ttl, provider);
    return { available: false, times: [] };
  }
}

/**
 * Refresh all available dates from API
 * @param {Object} client - Client with checkAvailableDate, checkAvailableTime
 * @param {Object} headers - Session headers
 * @param {string} scheduleId - Schedule ID
 * @param {number} facilityId - Facility ID
 * @param {number} ttl - Cache TTL in seconds
 * @param {string} [provider='ais']
 * @param {{ requestDelaySec?: number, rateLimitBackoffSec?: number }} [options] - Throttle and backoff for AIS rate limiting
 * @returns {Promise<Array<string>>} - Array of available dates
 */
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // log every 30s while waiting for API
const PROGRESS_STEP = 10; // log progress every N dates

export async function refreshAllDates(
  client,
  headers,
  scheduleId,
  facilityId,
  ttl = 60,
  provider = 'ais',
  options = {}
) {
  const requestDelaySec = options.requestDelaySec ?? 2;
  const rateLimitBackoffSec = options.rateLimitBackoffSec ?? 30;

  try {
    log('Fetching list of available dates from API...');
    let heartbeatTimer = setInterval(() => {
      log('Still fetching available dates from API...');
    }, HEARTBEAT_INTERVAL_MS);
    let dates;
    try {
      dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
    } finally {
      clearInterval(heartbeatTimer);
    }
    if (!dates || dates.length === 0) {
      log('No dates available from API');
      return [];
    }
    log(
      `Received ${dates.length} dates. Checking availability (delay ${requestDelaySec}s between requests)...`
    );
    const availableDates = [];
    const total = dates.length;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const result = await refreshDate(
        date,
        client,
        headers,
        scheduleId,
        facilityId,
        ttl,
        provider,
        { rateLimitBackoffSec }
      );
      if (result.available) availableDates.push(date);
      const n = i + 1;
      if (n % PROGRESS_STEP === 0 || n === total) {
        log(`Checking dates: ${n}/${total}...`);
      }
      if (n < total && requestDelaySec > 0) {
        await sleep(requestDelaySec);
      }
    }
    log(`Refreshed cache: ${availableDates.length} dates available`);
    return availableDates;
  } catch (error) {
    log(`Failed to refresh all dates: ${error.message}`);
    return [];
  }
}
