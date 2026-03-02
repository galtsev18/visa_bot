import { Bot } from './bot';
import { createVisaProvider } from '../adapters/VisaProviderFactory';
import { ProviderBackedClient } from '../adapters/ProviderBackedClient';
import { getNextUser, updateUserPriority } from './userRotation';
import {
  formatBookingSuccessWithDetails,
  formatSlotFound,
  formatBookingFailure,
  formatMonitorStarted,
} from './telegram';
import { logger } from './logger';
import { sleep, formatErrorForLog } from './utils';
import { checkUserWithCache as checkUserWithCacheUseCase } from '../application/checkUserWithCache';
import { attemptBooking as attemptBookingUseCase } from '../application/attemptBooking';
import { startMonitor as startMonitorUseCase } from '../application/startMonitor';
import { startMetrics, incrementChecks, incrementBookings } from './metrics';
import type { UserRepository } from '../ports/UserRepository';
import type { DateCache } from '../ports/DateCache';
import type { NotificationSender } from '../ports/NotificationSender';
import type { User } from '../ports/User';

export interface ManagerDeps {
  repo: UserRepository;
  dateCache: DateCache;
  notifications: NotificationSender;
}

export interface AppConfigLike {
  facilityId?: number;
  telegramManagerChatId?: string;
  sheetsRefreshInterval?: number;
  refreshInterval?: number;
  rotationCooldown?: number;
  cacheTtl?: number;
  telegramBotToken?: string;
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
  aisRequestDelaySec?: number;
  aisRateLimitBackoffSec?: number;
}

export class UserBotManager {
  config: AppConfigLike;
  deps: ManagerDeps;
  users: User[];
  bots: Map<string, Bot>;
  sessions: Map<string, Record<string, string> | Record<string, unknown>>;
  lastSheetsRefresh: Date | null;
  private _monitorStarted = false;

  constructor(config: AppConfigLike, deps: ManagerDeps) {
    if (!deps?.repo || !deps?.dateCache || !deps?.notifications) {
      throw new Error(
        'UserBotManager requires deps: { repo, dateCache, notifications }. Use createMonitorContext() and pass its adapters.'
      );
    }
    this.config = config;
    this.deps = deps;
    this.users = [];
    this.bots = new Map();
    this.sessions = new Map();
    this.lastSheetsRefresh = null;
  }

  async initializeUsers(users: User[]): Promise<void> {
    this.users = users;
    this.bots.clear();
    this.sessions.clear();

    logger.info(`Initializing ${users.length} users...`);

    for (const user of users) {
      try {
        const botConfig = {
          email: user.email,
          password: user.password,
          countryCode: user.countryCode,
          scheduleId: user.scheduleId,
          facilityId: this.config.facilityId ?? 134,
          refreshDelay: this.config.refreshInterval,
          provider: user.provider ?? 'ais',
          captchaSolver: this.config.captchaSolver ?? null,
          captchaApiKey: this.config.captcha2CaptchaApiKey ?? null,
        };

        const provider = createVisaProvider(botConfig.provider, {
          captcha2CaptchaApiKey: this.config.captcha2CaptchaApiKey ?? null,
          captchaSolver: this.config.captchaSolver ?? null,
        });
        const client = new ProviderBackedClient(provider, {
          email: user.email,
          password: user.password,
          countryCode: user.countryCode,
          scheduleId: user.scheduleId,
          facilityId: this.config.facilityId ?? 134,
        });

        const bot = new Bot(botConfig, { client });
        const sessionHeaders = await bot.initialize();

        this.bots.set(user.email, bot);
        this.sessions.set(user.email, sessionHeaders);

        logger.info(`Initialized bot for user ${user.email}`);
      } catch (error) {
        logger.error(`Failed to initialize bot for user ${user.email}: ${formatErrorForLog(error)}`);
      }
    }

    logger.info(`Initialized ${this.bots.size} bots`);
  }

  async checkUserWithCache(user: User): Promise<string | null> {
    const dc = this.deps.dateCache;
    return checkUserWithCacheUseCase(user, {
      bot: this.bots.get(user.email) ?? null,
      sessionHeaders: this.sessions.get(user.email) ?? null,
      config: { ...this.config, cacheTtl: this.config.cacheTtl ?? 60, facilityId: this.config.facilityId ?? 134 },
      getAvailableDates: (p) => dc.getAvailableDates(p),
      isCacheStale: (date, ttl, p) => dc.isCacheStale(date, ttl, p),
      refreshAllDates: (client, headers, scheduleId, facilityId, ttl, p, opts) =>
        dc.refreshAllDates(client, headers as Record<string, unknown>, scheduleId, facilityId, ttl, p, opts),
      isDateAvailable: (date, p) => dc.isDateAvailable(date, p),
      log: (msg) => logger.info(msg),
    });
  }

  async attemptBooking(user: User, date: string): Promise<boolean> {
    const repo = this.deps.repo;
    const notif = this.deps.notifications;
    const chatId = String(this.config.telegramManagerChatId ?? '');
    return attemptBookingUseCase(user, date, {
      bot: this.bots.get(user.email) ?? null,
      sessionHeaders: this.sessions.get(user.email) ?? null,
      config: this.config,
      updateUserCurrentDate: (e, d, t, r) => repo.updateUserCurrentDate(e, d, t ?? null, r),
      updateUserLastBooked: (e, d, t, r) => repo.updateUserLastBooked(e, d, t ?? null, r),
      logBookingAttempt: (a) =>
        repo.logBookingAttempt({
          ...a,
          date_attempted: a.date_attempted ?? null,
          result: (a.result ?? 'skipped') as 'success' | 'failure' | 'skipped',
        }),
      sendNotification: (msg) => notif.send(msg, chatId),
      formatBookingSuccessWithDetails: (u, o, n, t) => formatBookingSuccessWithDetails(u as import('./telegram').UserLike, o, n, t ?? null),
      formatBookingFailure: (u, d, r) => formatBookingFailure(u as import('./telegram').UserLike, d, r),
      log: (msg) => logger.info(msg),
    });
  }

  /**
   * Run one monitoring cycle: optionally start monitor (first call), then refresh users if needed,
   * get next user, check cache, attempt booking if date found, update priority. No sleep.
   * Used by monitorWithRotation and by integration tests.
   * @param initialCacheEntries - passed to startMonitor on first run
   * @param opts - skipSheetsRefresh: true to skip repo refresh (for tests with pre-set users)
   */
  async runOneCycle(
    initialCacheEntries?: Array<{ provider?: string; date: string }>,
    opts?: { skipSheetsRefresh?: boolean }
  ): Promise<void> {
    const repo = this.deps.repo;
    const dc = this.deps.dateCache;
    const notif = this.deps.notifications;
    const chatId = String(this.config.telegramManagerChatId ?? '');

    if (!this._monitorStarted) {
      await startMonitorUseCase(initialCacheEntries, {
        initializeCache: () => Promise.resolve(),
        getCacheStats: () => dc.getCacheStats(),
        formatMonitorStarted,
        sendNotification: (msg, chatIdArg) => notif.send(msg, chatIdArg || chatId),
        users: this.users,
        config: this.config,
      });
      startMetrics();
      this._monitorStarted = true;
    }

    if (!opts?.skipSheetsRefresh) {
      const now = new Date();
      if (
        !this.lastSheetsRefresh ||
        (now.getTime() - this.lastSheetsRefresh.getTime()) / 1000 > (this.config.sheetsRefreshInterval ?? 300)
      ) {
        logger.info('Refreshing users and settings from Google Sheets...');
        try {
          const [sheetSettings, freshUsers] = await Promise.all([
            repo.getSettingsOverrides(),
            repo.getActiveUsers(),
          ]);
          Object.assign(this.config, sheetSettings);
          await this.initializeUsers(freshUsers);
          this.lastSheetsRefresh = now;
          logger.info(`Refreshed users: ${freshUsers.length} active users`);
        } catch (error) {
          logger.error(`Failed to refresh users: ${formatErrorForLog(error)}`);
        }
      }
    }

    const user = getNextUser(this.users, this.config.rotationCooldown ?? 30);

    if (!user) {
      logger.info('No users to check, sleeping...');
      return;
    }

    logger.info(`Checking user ${user.email}...`);

    const availableDate = await this.checkUserWithCache(user);
    incrementChecks();

    if (availableDate) {
      const slotFoundMsg = formatSlotFound(user, availableDate);
      await notif.send(slotFoundMsg, chatId);
      const booked = await this.attemptBooking(user, availableDate);
      if (booked) incrementBookings();
    } else {
      await repo.logBookingAttempt({
        user_email: user.email,
        date_attempted: null,
        result: 'skipped',
        reason: 'No valid dates found',
      });
    }

    const checkedAt = new Date();
    updateUserPriority(user, checkedAt);
    await Promise.all([
      repo.updateUserLastChecked(user.email, checkedAt, user.rowIndex ?? undefined),
      repo.updateUserPriority(user.email, user.priority, user.rowIndex ?? undefined),
    ]);
  }

  async monitorWithRotation(initialCacheEntries?: Array<{ provider?: string; date: string }>): Promise<never> {
    logger.info('Starting monitoring loop with rotation...');

    while (true) {
      try {
        await this.runOneCycle(initialCacheEntries);
        await sleep(this.config.refreshInterval ?? 3);
      } catch (error) {
        logger.error(`Error in monitoring loop: ${formatErrorForLog(error)}`);
        await sleep(this.config.refreshInterval ?? 3);
      }
    }
  }
}
