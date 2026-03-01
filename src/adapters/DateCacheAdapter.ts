import type {
  DateCache,
  DateCacheClient,
  RefreshDatesOptions,
} from '../ports/DateCache.js';
import * as dateCacheLib from '../lib/dateCache.js';

/** Backend API for date cache (createDateCache() return value or global lib). */
export interface DateCacheBackend {
  initializeCache(preloadedEntries?: unknown): Promise<void>;
  getAvailableDates(provider: string): string[];
  isDateAvailable(date: string, provider: string): boolean;
  isCacheStale(date: string, ttl: number, provider: string): boolean;
  getCacheStats(): ReturnType<DateCache['getCacheStats']>;
  updateDate(date: string, available: boolean, times: string[], ttl: number, provider: string): void;
  refreshAllDates(
    client: unknown,
    headers: unknown,
    scheduleId: string,
    facilityId: number,
    ttl: number,
    provider: string,
    options?: RefreshDatesOptions
  ): Promise<string[]>;
}

/**
 * Adapter: implements DateCache port.
 * When backend is provided (from composition root), uses that instance; otherwise uses global lib/dateCache.
 */
export class DateCacheAdapter implements DateCache {
  private readonly backend: DateCacheBackend;

  constructor(backend?: DateCacheBackend) {
    this.backend = backend ?? (dateCacheLib as unknown as DateCacheBackend);
  }

  async initialize(
    preloadedEntries?: Parameters<DateCache['initialize']>[0]
  ): Promise<void> {
    await this.backend.initializeCache(preloadedEntries);
  }

  getAvailableDates(provider?: string): string[] {
    return this.backend.getAvailableDates(provider ?? 'ais');
  }

  isDateAvailable(date: string, provider?: string): boolean {
    return this.backend.isDateAvailable(date, provider ?? 'ais');
  }

  isCacheStale(
    date: string,
    ttlSeconds: number,
    provider?: string
  ): boolean {
    return this.backend.isCacheStale(date, ttlSeconds, provider ?? 'ais');
  }

  getCacheStats(): ReturnType<DateCache['getCacheStats']> {
    return this.backend.getCacheStats();
  }

  updateDate(
    date: string,
    available: boolean,
    times?: string[],
    ttlSeconds?: number,
    provider?: string
  ): void {
    this.backend.updateDate(date, available, times ?? [], ttlSeconds ?? 60, provider ?? 'ais');
  }

  async refreshAllDates(
    client: DateCacheClient,
    sessionHeaders: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    ttlSeconds: number,
    provider?: string,
    options?: RefreshDatesOptions
  ): Promise<string[]> {
    return this.backend.refreshAllDates(
      client,
      sessionHeaders,
      scheduleId,
      facilityId,
      ttlSeconds,
      provider ?? 'ais',
      options
    );
  }
}
