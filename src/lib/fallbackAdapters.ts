/**
 * Fallback adapters (TS): wrap lib/sheets, lib/dateCache, lib/telegram
 * so that the monitor can always pass the same deps to UserBotManager (П.10).
 * Use when composition root is not loaded (e.g. running from src).
 */

import * as sheets from './sheets';
import * as dateCache from './dateCache';
import { sendNotification } from './telegram';
import type { UserRepository } from '../ports/UserRepository';
import type { DateCache } from '../ports/DateCache';
import type { NotificationSender } from '../ports/NotificationSender';

export function createFallbackAdapters(): {
  repo: UserRepository;
  dateCache: DateCache;
  notifications: NotificationSender;
} {
  const repo: UserRepository = {
    initialize: async () => {
      /* no-op when using fallback; sheets already initialized */
    },
    getActiveUsers: () => sheets.readUsers(),
    getSettingsOverrides: () => sheets.readSettingsFromSheet() as Promise<import('../ports/UserRepository').SettingsOverrides>,
    getInitialData: async () => {
      const data = await sheets.getInitialData();
      return {
        users: data.users,
        cacheEntries: data.cacheEntries
          .filter((e): e is import('./sheets').CacheEntryFromSheet & { date: string } => !!e.date)
          .map((e) => ({
            ...e,
            available: e.available === true || e.available === 'TRUE',
          })),
      };
    },
    updateUserLastChecked: (email, timestamp, rowIndex) =>
      sheets.updateUserLastChecked(email, timestamp, rowIndex ?? undefined),
    updateUserCurrentDate: (email, newDate, timeSlot, rowIndex) =>
      sheets.updateUserCurrentDate(email, newDate, timeSlot ?? null, rowIndex ?? undefined),
    updateUserLastBooked: (email, date, timeSlot, rowIndex) =>
      sheets.updateUserLastBooked(email, date, timeSlot ?? null, rowIndex ?? undefined),
    updateUserPriority: (email, priority, rowIndex) =>
      sheets.updateUserPriority(email, priority, rowIndex ?? undefined),
    logBookingAttempt: (attempt) => sheets.logBookingAttempt(attempt as import('./sheets').BookingAttemptLog),
    updateAvailableDate: (date, available, times, facilityId) =>
      sheets.updateAvailableDate(date, available, times ?? [], facilityId),
  };

  const dateCacheAdapter: DateCache = {
    getAvailableDates: (provider) => dateCache.getAvailableDates(provider ?? 'ais'),
    isDateAvailable: (date, provider) => dateCache.isDateAvailable(date, provider ?? 'ais'),
    isCacheStale: (date, ttlSeconds, provider) =>
      dateCache.isCacheStale(date, ttlSeconds ?? 60, provider ?? 'ais'),
    getCacheStats: () => dateCache.getCacheStats(),
    initialize: (preloadedEntries) =>
      dateCache.initializeCache(preloadedEntries as Parameters<typeof dateCache.initializeCache>[0]),
    updateDate: (date, available, times, ttlSeconds, provider) =>
      dateCache.updateDate(date, available, times ?? [], ttlSeconds ?? 60, provider ?? 'ais'),
    refreshAllDates: (client, sessionHeaders, scheduleId, facilityId, ttlSeconds, provider, options) =>
      dateCache.refreshAllDates(
        client,
        sessionHeaders,
        scheduleId,
        facilityId,
        ttlSeconds ?? 60,
        provider ?? 'ais',
        options ?? {}
      ),
  };

  const notifications: NotificationSender = {
    send: (message, chatId) => sendNotification(message, chatId).then(() => true),
  };

  return { repo, dateCache: dateCacheAdapter, notifications };
}
