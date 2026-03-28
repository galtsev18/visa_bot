import { Bot } from './bot';
import { createVisaProvider } from '../adapters/VisaProviderFactory';
import { ProviderBackedClient } from '../adapters/ProviderBackedClient';
import {
  filterUsersForRotation,
  getNextUser,
  updateUserPriority,
} from '../domain/userRotation';
import {
  formatBookingSuccessWithDetails,
  formatSlotFound,
  formatBookingFailure,
  formatMonitorStarted,
  formatDailyStatsReport,
} from './telegram';
import { logger } from './logger';
import { sleep, formatErrorForLog } from './utils';
import { checkUserWithCache as checkUserWithCacheUseCase } from '../application/checkUserWithCache';
import { attemptBooking as attemptBookingUseCase } from '../application/attemptBooking';
import { startMonitor as startMonitorUseCase } from '../application/startMonitor';
import {
  startMetrics,
  incrementChecks,
  incrementBookings,
  incrementSlotsMissed,
  recordError,
  getMetrics,
  shouldSendDailyReport,
  markDailyReportSent,
} from './metrics';
import type { UserRepository } from '../ports/UserRepository';
import type { DateCache } from '../ports/DateCache';
import type { NotificationSender } from '../ports/NotificationSender';
import type { User } from '../ports/User';
import { resolveVfsProxy } from './geonixProxy';
import { localeFromLoginUrl } from './vfsUtils';
import { fetch2CaptchaBalance } from './captcha';

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
  vfsRequestDelaySec?: number;
  vfsRateLimitBackoffSec?: number;
  geonixApiKey?: string | null;
  vfsProxyCountry?: string | null;
  vfsProxyUrl?: string | null;
  pauseUsRotation?: boolean;
  pauseVfsRotation?: boolean;
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
    const pauseUs = !!this.config.pauseUsRotation;
    const pauseVfs = !!this.config.pauseVfsRotation;
    const eligible = filterUsersForRotation(users, pauseUs, pauseVfs);
    if (eligible.length < users.length) {
      logger.info(
        `Rotation pause: ${users.length - eligible.length} user(s) skipped (US paused: ${pauseUs}, VFS paused: ${pauseVfs})`
      );
    }
    this.users = eligible;
    this.bots.clear();
    this.sessions.clear();

    logger.info(`Initializing ${eligible.length} users...`);

    const hasVfs = eligible.some((u) => (u.provider || '').toLowerCase() === 'vfsglobal');
    const vfsProxy = hasVfs
      ? await resolveVfsProxy({
          vfsProxyUrl: this.config.vfsProxyUrl ?? null,
          geonixApiKey: this.config.geonixApiKey ?? null,
          vfsProxyCountry: this.config.vfsProxyCountry ?? null,
        })
      : null;
    if (hasVfs && vfsProxy) {
      logger.info(`VFS proxy resolved: ${vfsProxy.server}`);
    }

    for (const user of eligible) {
      try {
        const facilityId = user.facilityId ?? this.config.facilityId ?? 134;
        const botConfig = {
          email: user.email,
          password: user.password,
          countryCode: user.countryCode,
          scheduleId: user.scheduleId,
          facilityId,
          refreshDelay: this.config.refreshInterval,
          provider: user.provider ?? 'ais',
          captchaSolver: this.config.captchaSolver ?? null,
          captchaApiKey: this.config.captcha2CaptchaApiKey ?? null,
        };

        const provider = createVisaProvider(botConfig.provider, {
          captcha2CaptchaApiKey: this.config.captcha2CaptchaApiKey ?? null,
          captchaSolver: this.config.captchaSolver ?? null,
          vfsProxy: vfsProxy ?? undefined,
        });
        const effectiveCountryCode =
          (user.provider || '').toLowerCase() === 'vfsglobal'
            ? (user.countryCode?.trim() || localeFromLoginUrl(user.cabinetLink || '') || 'rus/en/fra')
            : user.countryCode;
        const client = new ProviderBackedClient(provider, {
          email: user.email,
          password: user.password,
          countryCode: effectiveCountryCode,
          scheduleId: user.scheduleId,
          facilityId,
          vfsCentre: user.vfsCentre,
          vfsCategory: user.vfsCategory,
          vfsSubcategory: user.vfsSubcategory,
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
      config: {
        ...this.config,
        cacheTtl: this.config.cacheTtl ?? 60,
        facilityId: user.facilityId ?? this.config.facilityId ?? 134,
      },
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
      onError: (reason) => recordError(reason),
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

    // Ежедневный отчёт в 10:00 (local time)
    const now = new Date();
    if (now.getHours() === 10 && now.getMinutes() < 5 && shouldSendDailyReport()) {
      try {
        const m = getMetrics();
        const apiKey = this.config.captcha2CaptchaApiKey?.trim();
        let captchaBalanceUsd: string | undefined;
        let captchaBalanceError: string | undefined;
        if (apiKey) {
          const bal = await fetch2CaptchaBalance(apiKey);
          if (bal.ok) captchaBalanceUsd = bal.balanceUsd;
          else captchaBalanceError = bal.error;
        }
        const report = formatDailyStatsReport({
          activeUsersCount: this.users.length,
          dailySlotsMissed: m.dailySlotsMissed ?? 0,
          dailyBookings: m.dailyBookings ?? 0,
          dailyErrorCounts: m.dailyErrorCounts ?? {},
          checksTotal: m.checksTotal,
          bookingsTotal: m.bookingsTotal,
          captchaBalanceUsd,
          captchaBalanceError,
        });
        await notif.send(report, chatId);
        markDailyReportSent();
        logger.info('Daily stats report sent');
      } catch (err) {
        logger.error(`Failed to send daily report: ${formatErrorForLog(err)}`);
      }
    }

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
      if (booked) {
        incrementBookings();
      } else {
        incrementSlotsMissed();
      }
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
    await repo.updateUserAfterCheck(
      user.email,
      checkedAt,
      user.priority,
      user.rowIndex ?? undefined
    );
  }

  async monitorWithRotation(initialCacheEntries?: Array<{ provider?: string; date: string }>): Promise<never> {
    logger.info('Starting monitoring loop with rotation...');

    while (true) {
      try {
        await this.runOneCycle(initialCacheEntries);
        await sleep(this.config.refreshInterval ?? 3);
      } catch (error) {
        const errMsg = formatErrorForLog(error);
        logger.error(`Error in monitoring loop: ${errMsg}`);
        recordError(errMsg);
        await sleep(this.config.refreshInterval ?? 3);
      }
    }
  }
}
