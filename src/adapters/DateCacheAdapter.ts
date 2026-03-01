import type {
  DateCache,
  DateCacheClient,
  RefreshDatesOptions,
} from '../ports/DateCache.js';
import * as dateCacheLib from '../lib/dateCache.js';

/**
 * Adapter: wraps existing dateCache.js to implement DateCache port.
 * Keeps current behavior (in-memory + Sheets persistence via sheets.updateAvailableDate).
 */
export class DateCacheAdapter implements DateCache {
  async initialize(
    preloadedEntries?: Parameters<DateCache['initialize']>[0]
  ): Promise<void> {
    await dateCacheLib.initializeCache(preloadedEntries);
  }

  getAvailableDates(provider?: string): string[] {
    return dateCacheLib.getAvailableDates(provider ?? 'ais');
  }

  isDateAvailable(date: string, provider?: string): boolean {
    return dateCacheLib.isDateAvailable(date, provider ?? 'ais');
  }

  isCacheStale(
    date: string,
    ttlSeconds: number,
    provider?: string
  ): boolean {
    return dateCacheLib.isCacheStale(date, ttlSeconds, provider ?? 'ais');
  }

  getCacheStats(): ReturnType<DateCache['getCacheStats']> {
    return dateCacheLib.getCacheStats();
  }

  updateDate(
    date: string,
    available: boolean,
    times?: string[],
    ttlSeconds?: number,
    provider?: string
  ): void {
    dateCacheLib.updateDate(date, available, times ?? [], ttlSeconds ?? 60, provider ?? 'ais');
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
    return dateCacheLib.refreshAllDates(
      client as Parameters<typeof dateCacheLib.refreshAllDates>[0],
      sessionHeaders as Parameters<typeof dateCacheLib.refreshAllDates>[1],
      scheduleId,
      facilityId,
      ttlSeconds,
      provider ?? 'ais',
      options
    );
  }
}
