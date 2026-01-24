import { log } from './utils.js';
import { readAvailableDatesCache, updateAvailableDate } from './sheets.js';

let cache = new Map(); // In-memory cache: date -> { available, times, lastChecked, validUntil }
let cacheInitialized = false;

/**
 * Initialize cache from Google Sheets
 */
export async function initializeCache() {
  try {
    const cacheEntries = await readAvailableDatesCache();
    
    cache.clear();
    for (const entry of cacheEntries) {
      const key = entry.date;
      cache.set(key, {
        available: entry.available === true || entry.available === 'TRUE',
        times: entry.times_available || [],
        lastChecked: entry.last_checked ? new Date(entry.last_checked) : new Date(),
        validUntil: entry.cache_valid_until ? new Date(entry.cache_valid_until) : new Date(Date.now() + 60000)
      });
    }
    
    cacheInitialized = true;
    log(`Initialized cache with ${cache.size} entries`);
  } catch (error) {
    log(`Failed to initialize cache: ${error.message}`);
    cacheInitialized = true; // Mark as initialized even if failed
  }
}

/**
 * Get available dates from cache
 * @returns {Array<string>} - Array of available dates (YYYY-MM-DD)
 */
export function getAvailableDates() {
  const now = new Date();
  const availableDates = [];

  for (const [date, entry] of cache.entries()) {
    if (entry.available && entry.validUntil > now) {
      availableDates.push(date);
    }
  }

  return availableDates.sort();
}

/**
 * Check if a date is in the cache
 * @param {string} date - Date (YYYY-MM-DD)
 * @returns {boolean}
 */
export function isDateCached(date) {
  return cache.has(date);
}

/**
 * Check if a cached date is available
 * @param {string} date - Date (YYYY-MM-DD)
 * @returns {boolean}
 */
export function isDateAvailable(date) {
  const entry = cache.get(date);
  if (!entry) {
    return false;
  }

  const now = new Date();
  if (entry.validUntil <= now) {
    return false; // Cache expired
  }

  return entry.available === true;
}

/**
 * Get available times for a date from cache
 * @param {string} date - Date (YYYY-MM-DD)
 * @returns {Array<string>}
 */
export function getAvailableTimes(date) {
  const entry = cache.get(date);
  if (!entry) {
    return [];
  }

  const now = new Date();
  if (entry.validUntil <= now) {
    return []; // Cache expired
  }

  return entry.times || [];
}

/**
 * Check if cache entry is stale
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {number} ttl - Time-to-live in seconds
 * @returns {boolean}
 */
export function isCacheStale(date, ttl = 60) {
  const entry = cache.get(date);
  if (!entry) {
    return true; // Not cached, consider stale
  }

  const now = new Date();
  const age = (now - entry.lastChecked) / 1000; // Age in seconds
  return age > ttl || entry.validUntil <= now;
}

/**
 * Update cache entry
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {boolean} available - Is date available
 * @param {Array<string>} times - Available time slots
 * @param {number} ttl - Time-to-live in seconds
 */
export function updateDate(date, available, times = [], ttl = 60) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + (ttl * 1000));

  cache.set(date, {
    available,
    times,
    lastChecked: now,
    validUntil
  });

  // Also update in Google Sheets (async, don't wait)
  updateAvailableDate(date, available, times).catch(err => {
    log(`Failed to update cache in Sheets for ${date}: ${err.message}`);
  });
}

/**
 * Get stale dates that need refresh
 * @param {number} ttl - Time-to-live in seconds
 * @returns {Array<string>}
 */
export function getStaleDates(ttl = 60) {
  const staleDates = [];
  const now = new Date();

  for (const [date, entry] of cache.entries()) {
    const age = (now - entry.lastChecked) / 1000;
    if (age > ttl || entry.validUntil <= now) {
      staleDates.push(date);
    }
  }

  return staleDates;
}

/**
 * Refresh a date from API and update cache
 * @param {string} date - Date to refresh
 * @param {Object} client - VisaHttpClient instance
 * @param {Object} headers - Session headers
 * @param {string} scheduleId - Schedule ID
 * @param {number} facilityId - Facility ID
 * @param {number} ttl - Cache TTL in seconds
 * @returns {Promise<Object>} - { available, times }
 */
export async function refreshDate(date, client, headers, scheduleId, facilityId, ttl = 60) {
  try {
    // Check available times for this specific date
    const time = await client.checkAvailableTime(headers, scheduleId, facilityId, date);
    const available = time !== null && time !== undefined;

    const times = available ? [time] : [];

    updateDate(date, available, times, ttl);
    
    log(`Refreshed cache for date ${date}: available=${available}`);
    return { available, times };
  } catch (error) {
    log(`Failed to refresh date ${date}: ${error.message}`);
    // Mark as unavailable on error
    updateDate(date, false, [], ttl);
    return { available: false, times: [] };
  }
}

/**
 * Refresh all available dates from API
 * @param {Object} client - VisaHttpClient instance
 * @param {Object} headers - Session headers
 * @param {string} scheduleId - Schedule ID
 * @param {number} facilityId - Facility ID
 * @param {number} ttl - Cache TTL in seconds
 * @returns {Promise<Array<string>>} - Array of available dates
 */
export async function refreshAllDates(client, headers, scheduleId, facilityId, ttl = 60) {
  try {
    const dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
    
    if (!dates || dates.length === 0) {
      log('No dates available from API');
      return [];
    }

    // Update cache for all dates
    const availableDates = [];
    for (const date of dates) {
      const result = await refreshDate(date, client, headers, scheduleId, facilityId, ttl);
      if (result.available) {
        availableDates.push(date);
      }
    }

    log(`Refreshed cache: ${availableDates.length} dates available`);
    return availableDates;
  } catch (error) {
    log(`Failed to refresh all dates: ${error.message}`);
    return [];
  }
}
