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
import { SheetsUserRepository } from '../adapters/SheetsUserRepository.js';
import { TelegramNotificationAdapter } from '../adapters/TelegramNotificationAdapter.js';
import { DateCacheAdapter } from '../adapters/DateCacheAdapter.js';
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
 * Build config (env + sheet overrides), initialize repo and Telegram;
 * return config and initial data for the monitor loop (cache is initialized in the loop).
 */
export async function createMonitorContext(
  options: CreateMonitorContextOptions = {}
): Promise<MonitorContext> {
  const configProvider = new EnvConfigProvider();
  let config = configProvider.getConfig();

  validateEnvForSheets(config as Parameters<typeof validateEnvForSheets>[0]);

  const repo = new SheetsUserRepository();
  await repo.initialize(
    config.googleCredentialsPath!,
    config.googleSheetsId!
  );

  const sheetOverrides = await repo.getSettingsOverrides();
  config = { ...config, ...sheetOverrides } as AppConfig;
  if (options.refreshInterval != null) config.refreshInterval = options.refreshInterval;
  if (options.sheetsRefresh != null) config.sheetsRefreshInterval = options.sheetsRefresh;

  validateMultiUserConfig(config as Parameters<typeof validateMultiUserConfig>[0]);

  const chatId = String(config.telegramManagerChatId ?? '').trim();
  const notifications = new TelegramNotificationAdapter({
    token: String(config.telegramBotToken ?? '').trim(),
    defaultChatId: chatId,
  });
  notifications.init();

  // Quota notifier is registered once in monitor.js for both composition root and fallback paths

  const { users, cacheEntries } = await repo.getInitialData();

  const dateCache = new DateCacheAdapter();
  await dateCache.initialize(
    cacheEntries as Parameters<DateCache['initialize']>[0]
  );

  return { config, users, cacheEntries, repo, dateCache, notifications };
}
