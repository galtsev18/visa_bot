/**
 * Composition root for the monitor command.
 * Creates adapters, initializes them, merges config from Settings sheet,
 * and returns config + initial data + adapters for the monitoring loop.
 * Use this when running from dist so the monitor uses ports/adapters for setup.
 */

import type { AppConfig } from '../ports/AppConfig.js';
import type { UserRepository } from '../ports/UserRepository.js';
import type { DateCache } from '../ports/DateCache.js';
import type { NotificationSender } from '../ports/NotificationSender.js';
import { EnvConfigProvider } from '../adapters/EnvConfigProvider.js';
import { MergedConfigProvider } from '../adapters/EnvConfigProvider.js';
import { SheetsUserRepository } from '../adapters/SheetsUserRepository.js';
import { TelegramNotificationAdapter } from '../adapters/TelegramNotificationAdapter.js';
import { DateCacheAdapter } from '../adapters/DateCacheAdapter.js';
import type { DateCacheBackend } from '../adapters/DateCacheAdapter.js';
import { createDateCache } from '../lib/dateCache.js';
import {
  validateEnvForSheets,
  validateMultiUserConfig,
} from '../lib/config.js';

export interface MonitorContext {
  config: AppConfig;
  /** Adapters for use when running via composition root (monitor passes to UserBotManager). */
  repo: UserRepository;
  dateCache: DateCache;
  notifications: NotificationSender;
  users: Array<{
    email: string;
    password: string;
    countryCode: string;
    scheduleId: string;
    currentDate: string | null;
    reactionTime: number;
    dateRanges: Array<{ from: Date; to: Date }>;
    active: boolean;
    lastChecked: Date | null;
    lastBooked: string | null;
    priority: number;
    provider: string;
    rowIndex?: number | null;
    isDateValid: (date: string | Date) => boolean;
    needsAppointment: () => boolean;
  }>;
  cacheEntries: Array<{
    provider?: string;
    date: string;
    available?: boolean;
    times_available?: string[] | unknown;
    last_checked?: string;
    cache_valid_until?: string;
  }>;
}

export interface CreateMonitorContextOptions {
  refreshInterval?: number;
  sheetsRefresh?: number;
}

/**
 * Build config (env + Settings via MergedConfigProvider), then create adapters;
 * return config and initial data for the monitor loop.
 */
export async function createMonitorContext(
  options: CreateMonitorContextOptions = {}
): Promise<MonitorContext> {
  const envProvider = new EnvConfigProvider();
  const repo = new SheetsUserRepository();
  const configProvider = new MergedConfigProvider(envProvider, repo);
  const config = await configProvider.getConfig();

  validateEnvForSheets(config as Parameters<typeof validateEnvForSheets>[0]);
  if (options.refreshInterval != null) config.refreshInterval = options.refreshInterval;
  if (options.sheetsRefresh != null) config.sheetsRefreshInterval = options.sheetsRefresh;
  validateMultiUserConfig(config as Parameters<typeof validateMultiUserConfig>[0]);

  const chatId = String(config.telegramManagerChatId ?? '').trim();
  const notifications = new TelegramNotificationAdapter({
    token: String(config.telegramBotToken ?? '').trim(),
    defaultChatId: chatId,
  });
  notifications.init();

  const { users, cacheEntries } = await repo.getInitialData();

  const dateCacheBackend = createDateCache({
    persist: (date, available, times, facilityId) =>
      repo.updateAvailableDate(date, available, times ?? [], facilityId ?? 134),
  }) as DateCacheBackend;
  const dateCache = new DateCacheAdapter(dateCacheBackend);
  await dateCache.initialize(
    cacheEntries as Parameters<DateCache['initialize']>[0]
  );

  return { config, users, cacheEntries, repo, dateCache, notifications };
}
