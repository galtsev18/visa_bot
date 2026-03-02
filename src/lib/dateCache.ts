import type { DateCacheClient } from '../ports/DateCache';
import type { RefreshDatesOptions } from '../ports/DateCache';
import { logger } from './logger';
import { sleep, isSocketHangupError, formatErrorForLog } from './utils';
import { readAvailableDatesCache, updateAvailableDate } from './sheets';

interface CacheEntry {
  available: boolean;
  times: string[];
  lastChecked: Date;
  validUntil: Date;
}

interface CacheEntryFromSheet {
  provider?: string;
  date: string;
  available?: boolean | string;
  times_available?: string[];
  last_checked?: string;
  cache_valid_until?: string;
}

export interface CreateDateCacheOptions {
  persist?: (date: string, available: boolean, times: string[], facilityId?: number) => Promise<void>;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(provider: string, date: string): string {
  return `${(provider || 'ais').toLowerCase()}_${date}`;
}

function toCacheEntry(entry: {
  available?: boolean | string;
  times_available?: string | string[];
  last_checked?: string;
  cache_valid_until?: string;
}): CacheEntry {
  const times = entry.times_available;
  return {
    available: entry.available === true || entry.available === 'TRUE',
    times: Array.isArray(times) ? times : times ? [times] : [],
    lastChecked: entry.last_checked ? new Date(entry.last_checked) : new Date(),
    validUntil: entry.cache_valid_until
      ? new Date(entry.cache_valid_until)
      : new Date(Date.now() + 60000),
  };
}

export async function initializeCache(
  preloadedEntries?: CacheEntryFromSheet[]
): Promise<void> {
  try {
    const cacheEntries = Array.isArray(preloadedEntries)
      ? preloadedEntries
      : await readAvailableDatesCache();

    cache.clear();
    for (const entry of cacheEntries) {
      if (!entry.date) continue;
      const key = cacheKey((entry.provider as string) || 'ais', entry.date);
      cache.set(key, toCacheEntry(entry));
    }

    logger.info(`Initialized cache with ${cache.size} entries`);
  } catch (error: unknown) {
    logger.error(`Failed to initialize cache: ${formatErrorForLog(error)}`);
  }
}

export function getAvailableDates(provider = 'ais'): string[] {
  const now = new Date();
  const prefix = `${(provider || 'ais').toLowerCase()}_`;
  const availableDates: string[] = [];

  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (entry.available && entry.validUntil > now) {
      availableDates.push(key.slice(prefix.length));
    }
  }

  return availableDates.sort();
}

export function isDateAvailable(date: string, provider = 'ais'): boolean {
  const entry = cache.get(cacheKey(provider, date));
  if (!entry) return false;
  const now = new Date();
  if (entry.validUntil <= now) return false;
  return entry.available === true;
}

export function isCacheStale(date: string, ttl = 60, provider = 'ais'): boolean {
  const entry = cache.get(cacheKey(provider, date));
  if (!entry) return true;
  const now = new Date();
  const age = (now.getTime() - entry.lastChecked.getTime()) / 1000;
  return age > ttl || entry.validUntil <= now;
}

export function updateDate(
  date: string,
  available: boolean,
  times: string[] = [],
  ttl = 60,
  provider = 'ais'
): void {
  const now = new Date();
  const validUntil = new Date(now.getTime() + ttl * 1000);
  const key = cacheKey(provider, date);
  cache.set(key, {
    available,
    times,
    lastChecked: now,
    validUntil,
  });

  updateAvailableDate(date, available, times).catch((err: unknown) => {
    logger.error(`Failed to update cache in Sheets for ${date}: ${formatErrorForLog(err)}`);
  });
}

export function getCacheStats(): {
  total: number;
  providers: Record<string, { entries: number; available: number }>;
} {
  const now = new Date();
  const providers: Record<string, { entries: number; available: number }> = {};
  for (const [key, entry] of cache.entries()) {
    const sep = key.indexOf('_');
    const providerName = sep >= 0 ? key.slice(0, sep) : 'ais';
    if (!providers[providerName]) {
      providers[providerName] = { entries: 0, available: 0 };
    }
    providers[providerName].entries += 1;
    if (entry.available && entry.validUntil > now) {
      providers[providerName].available += 1;
    }
  }
  return { total: cache.size, providers };
}

export async function refreshDate(
  date: string,
  client: DateCacheClient,
  headers: Record<string, unknown>,
  scheduleId: string,
  facilityId: number,
  ttl = 60,
  provider = 'ais',
  options: { rateLimitBackoffSec?: number } = {}
): Promise<{ available: boolean; times: string[] }> {
  const rateLimitBackoffSec = options.rateLimitBackoffSec ?? 30;

  const tryFetch = async () => {
    const time = await client.checkAvailableTime(headers, scheduleId, facilityId, date);
    const available = time !== null && time !== undefined;
    const times = available ? [time as string] : [];
    updateDate(date, available, times, ttl, provider);
    logger.info(`Refreshed cache for date ${date}: available=${available}`);
    return { available, times };
  };

  try {
    return await tryFetch();
  } catch (error: unknown) {
    if (isSocketHangupError(error)) {
      logger.info(
        `Rate limit / socket hang up for date ${date}, backing off ${rateLimitBackoffSec}s before retry...`
      );
      await sleep(rateLimitBackoffSec);
      try {
        return await tryFetch();
      } catch (retryErr: unknown) {
        logger.error(`Failed to refresh date ${date} (after retry): ${formatErrorForLog(retryErr)}`);
        updateDate(date, false, [], ttl, provider);
        return { available: false, times: [] };
      }
    }
    logger.error(`Failed to refresh date ${date}: ${formatErrorForLog(error)}`);
    updateDate(date, false, [], ttl, provider);
    return { available: false, times: [] };
  }
}

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const PROGRESS_STEP = 10;

export async function refreshAllDates(
  client: DateCacheClient,
  headers: Record<string, unknown>,
  scheduleId: string,
  facilityId: number,
  ttl = 60,
  provider = 'ais',
  options: RefreshDatesOptions = {}
): Promise<string[]> {
  const requestDelaySec = options.requestDelaySec ?? 2;
  const rateLimitBackoffSec = options.rateLimitBackoffSec ?? 30;

  try {
    logger.info('Fetching list of available dates from API...');
    const heartbeatTimer = setInterval(() => {
      logger.info('Still fetching available dates from API...');
    }, HEARTBEAT_INTERVAL_MS);
    let dates: string[] | undefined;
    try {
      dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
    } finally {
      clearInterval(heartbeatTimer);
    }
    if (!dates || dates.length === 0) {
      logger.info('No dates available from API');
      return [];
    }
    logger.info(
      `Received ${dates.length} dates. Checking availability (delay ${requestDelaySec}s between requests)...`
    );
    const availableDates: string[] = [];
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
        logger.info(`Checking dates: ${n}/${total}...`);
      }
      if (n < total && requestDelaySec > 0) {
        await sleep(requestDelaySec);
      }
    }
    logger.info(`Refreshed cache: ${availableDates.length} dates available`);
    return availableDates;
  } catch (error: unknown) {
    logger.error(`Failed to refresh all dates: ${formatErrorForLog(error)}`);
    return [];
  }
}

export interface DateCacheInstance {
  initializeCache(preloadedEntries?: CacheEntryFromSheet[]): Promise<void>;
  getAvailableDates(provider?: string): string[];
  isDateAvailable(date: string, provider?: string): boolean;
  isCacheStale(date: string, ttl?: number, provider?: string): boolean;
  getCacheStats(): ReturnType<typeof getCacheStats>;
  updateDate(
    date: string,
    available: boolean,
    times?: string[],
    ttl?: number,
    provider?: string
  ): void;
  refreshAllDates(
    client: DateCacheClient,
    headers: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    ttl?: number,
    provider?: string,
    options?: RefreshDatesOptions
  ): Promise<string[]>;
}

export function createDateCache(options: CreateDateCacheOptions = {}): DateCacheInstance {
  const cacheLocal = new Map<string, CacheEntry>();
  const persist =
    options.persist ||
    ((date: string, available: boolean, times: string[], facilityId?: number) =>
      updateAvailableDate(date, available, times || [], facilityId || 134));

  async function initCache(preloadedEntries?: CacheEntryFromSheet[]): Promise<void> {
    try {
      const cacheEntries = Array.isArray(preloadedEntries)
        ? preloadedEntries
        : await readAvailableDatesCache();
      cacheLocal.clear();
      for (const entry of cacheEntries) {
        if (!entry.date) continue;
        const key = cacheKey((entry.provider as string) || 'ais', entry.date);
        cacheLocal.set(key, toCacheEntry(entry));
      }
      logger.info(`Initialized cache with ${cacheLocal.size} entries`);
    } catch (error: unknown) {
      logger.error(`Failed to initialize cache: ${formatErrorForLog(error)}`);
    }
  }

  function getDates(provider = 'ais'): string[] {
    const now = new Date();
    const prefix = `${(provider || 'ais').toLowerCase()}_`;
    const availableDates: string[] = [];
    for (const [key, entry] of cacheLocal.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (entry.available && entry.validUntil > now) {
        availableDates.push(key.slice(prefix.length));
      }
    }
    return availableDates.sort();
  }

  function isAvailable(date: string, provider = 'ais'): boolean {
    const entry = cacheLocal.get(cacheKey(provider, date));
    if (!entry) return false;
    const now = new Date();
    if (entry.validUntil <= now) return false;
    return entry.available === true;
  }

  function isStale(date: string, ttl = 60, provider = 'ais'): boolean {
    const entry = cacheLocal.get(cacheKey(provider, date));
    if (!entry) return true;
    const now = new Date();
    const age = (now.getTime() - entry.lastChecked.getTime()) / 1000;
    return age > ttl || entry.validUntil <= now;
  }

  function getStats(): { total: number; providers: Record<string, { entries: number; available: number }> } {
    const now = new Date();
    const providers: Record<string, { entries: number; available: number }> = {};
    for (const [key, entry] of cacheLocal.entries()) {
      const sep = key.indexOf('_');
      const providerName = sep >= 0 ? key.slice(0, sep) : 'ais';
      if (!providers[providerName]) {
        providers[providerName] = { entries: 0, available: 0 };
      }
      providers[providerName].entries += 1;
      if (entry.available && entry.validUntil > now) {
        providers[providerName].available += 1;
      }
    }
    return { total: cacheLocal.size, providers };
  }

  function update(
    date: string,
    available: boolean,
    times: string[] = [],
    ttl = 60,
    provider = 'ais'
  ): void {
    const now = new Date();
    const validUntil = new Date(now.getTime() + ttl * 1000);
    const key = cacheKey(provider, date);
    cacheLocal.set(key, {
      available,
      times,
      lastChecked: now,
      validUntil,
    });
    persist(date, available, times, 134).catch((err: unknown) => {
      logger.error(`Failed to update cache in Sheets for ${date}: ${formatErrorForLog(err)}`);
    });
  }

  async function refreshOne(
    date: string,
    client: DateCacheClient,
    headers: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    ttl = 60,
    provider = 'ais',
    opts: RefreshDatesOptions = {}
  ): Promise<{ available: boolean; times: string[] }> {
    const rateLimitBackoffSec = opts.rateLimitBackoffSec ?? 30;
    const tryFetch = async () => {
      const time = await client.checkAvailableTime(headers, scheduleId, facilityId, date);
      const available = time !== null && time !== undefined;
      const times = available ? [time as string] : [];
      update(date, available, times, ttl, provider);
      logger.info(`Refreshed cache for date ${date}: available=${available}`);
      return { available, times };
    };
    try {
      return await tryFetch();
    } catch (error: unknown) {
      if (isSocketHangupError(error)) {
        logger.info(`Rate limit / socket hang up for date ${date}, backing off ${rateLimitBackoffSec}s before retry...`);
        await sleep(rateLimitBackoffSec);
        try {
          return await tryFetch();
        } catch (retryErr: unknown) {
          logger.error(`Failed to refresh date ${date} (after retry): ${formatErrorForLog(retryErr)}`);
          update(date, false, [], ttl, provider);
          return { available: false, times: [] };
        }
      }
      logger.error(`Failed to refresh date ${date}: ${formatErrorForLog(error)}`);
      update(date, false, [], ttl, provider);
      return { available: false, times: [] };
    }
  }

  async function refreshAll(
    client: DateCacheClient,
    headers: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    ttl = 60,
    provider = 'ais',
    opts: RefreshDatesOptions = {}
  ): Promise<string[]> {
    const requestDelaySec = opts.requestDelaySec ?? 2;
    const rateLimitBackoffSec = opts.rateLimitBackoffSec ?? 30;
    try {
      logger.info('Fetching list of available dates from API...');
      const heartbeatTimer = setInterval(
        () => logger.info('Still fetching available dates from API...'),
        HEARTBEAT_INTERVAL_MS
      );
      let dates: string[] | undefined;
      try {
        dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
      } finally {
        clearInterval(heartbeatTimer);
      }
      if (!dates || dates.length === 0) {
        logger.info('No dates available from API');
        return [];
      }
      logger.info(`Received ${dates.length} dates. Checking availability (delay ${requestDelaySec}s between requests)...`);
      const availableDates: string[] = [];
      const total = dates.length;
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const result = await refreshOne(
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
        if (n % PROGRESS_STEP === 0 || n === total) logger.info(`Checking dates: ${n}/${total}...`);
        if (n < total && requestDelaySec > 0) await sleep(requestDelaySec);
      }
      logger.info(`Refreshed cache: ${availableDates.length} dates available`);
      return availableDates;
    } catch (error: unknown) {
      logger.error(`Failed to refresh all dates: ${formatErrorForLog(error)}`);
      return [];
    }
  }

  return {
    initializeCache: initCache,
    getAvailableDates: getDates,
    isDateAvailable: isAvailable,
    isCacheStale: isStale,
    getCacheStats: getStats,
    updateDate: update,
    refreshAllDates: refreshAll,
  };
}
