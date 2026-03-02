/**
 * Composition root for the monitor command.
 * Creates adapters, initializes them, merges config from Settings sheet,
 * and returns config + initial data + adapters for the monitoring loop.
 * Use this when running from dist so the monitor uses ports/adapters for setup.
 */

import type { User } from '../ports/User';
import type { AppConfig } from '../ports/AppConfig';
import type { UserRepository } from '../ports/UserRepository';
import type { DateCache } from '../ports/DateCache';
import type { NotificationSender } from '../ports/NotificationSender';
import { EnvConfigProvider } from '../adapters/EnvConfigProvider';
import { MergedConfigProvider } from '../adapters/EnvConfigProvider';
import { SheetsUserRepository } from '../adapters/SheetsUserRepository';
import { TelegramNotificationAdapter } from '../adapters/TelegramNotificationAdapter';
import { DateCacheAdapter } from '../adapters/DateCacheAdapter';
import type { DateCacheBackend } from '../adapters/DateCacheAdapter';
import { createDateCache } from '../lib/dateCache';
import {
  validateEnvForSheets,
  validateMultiUserConfig,
} from '../lib/config';

export interface MonitorContext {
  config: AppConfig;
  /** Adapters for use when running via composition root (monitor passes to UserBotManager). */
  repo: UserRepository;
  dateCache: DateCache;
  notifications: NotificationSender;
  users: User[];
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
