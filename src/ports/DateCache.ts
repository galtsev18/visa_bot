/**
 * Options when refreshing dates (rate limit, backoff).
 */
export interface RefreshDatesOptions {
  requestDelaySec?: number;
  rateLimitBackoffSec?: number;
}

/**
 * Client used by cache to fetch dates/times (provider-agnostic).
 * Typically the same object that implements VisaProvider or wraps session + provider.
 */
export interface DateCacheClient {
  checkAvailableDate(
    headers: Record<string, unknown>,
    scheduleId: string,
    facilityId: number
  ): Promise<string[]>;
  checkAvailableTime(
    headers: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    date: string
  ): Promise<string | null>;
}

/**
 * Port: cache of available appointment dates per provider.
 * Can be in-memory only or in-memory + persist to storage (e.g. Sheets).
 * @implemented_by DateCacheAdapter (adapters), wraps lib/dateCache.js
 */
export interface DateCache {
  getAvailableDates(provider?: string): string[];

  isDateAvailable(date: string, provider?: string): boolean;

  isCacheStale(date: string, ttlSeconds: number, provider?: string): boolean;

  getCacheStats(): {
    total: number;
    providers: Record<string, { entries: number; available: number }>;
  };

  initialize(preloadedEntries?: Array<{
    provider?: string;
    date: string;
    available?: boolean;
    times_available?: string[];
    last_checked?: string;
    cache_valid_until?: string;
  }>): Promise<void>;

  /**
   * Update a single cache entry (in-memory + persist to storage when applicable).
   * Matches lib/dateCache.updateDate capability.
   */
  updateDate(
    date: string,
    available: boolean,
    times?: string[],
    ttlSeconds?: number,
    provider?: string
  ): void;

  refreshAllDates(
    client: DateCacheClient,
    sessionHeaders: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    ttlSeconds: number,
    provider?: string,
    options?: RefreshDatesOptions
  ): Promise<string[]>;
}
