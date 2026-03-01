/**
 * Fallback adapters (JS): wrap lib/sheets, lib/dateCache, lib/telegram
 * so that the monitor can always pass the same deps to UserBotManager (П.10).
 * Use when composition root is not loaded (e.g. running from src).
 */

import * as sheets from './sheets.js';
import * as dateCache from './dateCache.js';
import { sendNotification } from './telegram.js';

/**
 * Create repo/dateCache/notifications adapters that delegate to the already-initialized lib.
 * Call after initializeSheets(), initializeCache(cacheEntries), initializeTelegram().
 * @returns {{ repo: import('../ports/UserRepository.js').UserRepository, dateCache: import('../ports/DateCache.js').DateCache, notifications: import('../ports/NotificationSender.js').NotificationSender }}
 */
export function createFallbackAdapters() {
  const repo = {
    getActiveUsers: () => sheets.readUsers(),
    getSettingsOverrides: () => sheets.readSettingsFromSheet(),
    getInitialData: () => sheets.getInitialData(),
    updateUserLastChecked: (email, timestamp, rowIndex) =>
      sheets.updateUserLastChecked(email, timestamp, rowIndex),
    updateUserCurrentDate: (email, newDate, timeSlot, rowIndex) =>
      sheets.updateUserCurrentDate(email, newDate, timeSlot ?? null, rowIndex),
    updateUserLastBooked: (email, date, timeSlot, rowIndex) =>
      sheets.updateUserLastBooked(email, date, timeSlot ?? null, rowIndex),
    updateUserPriority: (email, priority, rowIndex) =>
      sheets.updateUserPriority(email, priority, rowIndex),
    logBookingAttempt: (attempt) => sheets.logBookingAttempt(attempt),
    updateAvailableDate: (date, available, times, facilityId) =>
      sheets.updateAvailableDate(date, available, times ?? [], facilityId),
  };

  const dateCacheAdapter = {
    getAvailableDates: (provider) => dateCache.getAvailableDates(provider ?? 'ais'),
    isDateAvailable: (date, provider) => dateCache.isDateAvailable(date, provider ?? 'ais'),
    isCacheStale: (date, ttlSeconds, provider) =>
      dateCache.isCacheStale(date, ttlSeconds, provider ?? 'ais'),
    getCacheStats: () => dateCache.getCacheStats(),
    initialize: (preloadedEntries) => dateCache.initializeCache(preloadedEntries ?? []),
    updateDate: (date, available, times, ttlSeconds, provider) =>
      dateCache.updateDate(date, available, times ?? [], ttlSeconds ?? 60, provider ?? 'ais'),
    refreshAllDates: (client, sessionHeaders, scheduleId, facilityId, ttlSeconds, provider, options) =>
      dateCache.refreshAllDates(
        client,
        sessionHeaders,
        scheduleId,
        facilityId,
        ttlSeconds,
        provider ?? 'ais',
        options
      ),
  };

  const notifications = {
    send: (message, chatId) => sendNotification(message, chatId).then(() => true),
  };

  return { repo, dateCache: dateCacheAdapter, notifications };
}
