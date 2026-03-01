import { Bot } from './bot.js';
import { getNextUser, updateUserPriority } from './userRotation.js';
import {
  getAvailableDates,
  isCacheStale,
  refreshAllDates,
  isDateAvailable,
  initializeCache,
  getCacheStats,
} from './dateCache.js';
import {
  readUsers,
  readSettingsFromSheet,
  updateUserLastChecked,
  updateUserCurrentDate,
  updateUserLastBooked,
  updateUserPriority as updateUserPriorityInSheets,
  logBookingAttempt,
} from './sheets.js';
import {
  sendNotification,
  formatBookingSuccessWithDetails,
  formatSlotFound,
  formatBookingFailure,
  formatMonitorStarted,
} from './telegram.js';
import { log, sleep, formatErrorForLog } from './utils.js';
import { checkUserWithCache as checkUserWithCacheUseCase } from '../application/checkUserWithCache.js';
import { attemptBooking as attemptBookingUseCase } from '../application/attemptBooking.js';
import { startMonitor as startMonitorUseCase } from '../application/startMonitor.js';

/**
 * Optional dependencies (ports). When provided (e.g. from composition root),
 * use them instead of lib/sheets, lib/dateCache, lib/telegram.
 * @typedef {{ repo?: import('../ports/UserRepository.js').UserRepository, dateCache?: import('../ports/DateCache.js').DateCache, notifications?: import('../ports/NotificationSender.js').NotificationSender }} ManagerDeps
 */

export class UserBotManager {
  /**
   * @param {object} config - App config
   * @param {ManagerDeps} [deps] - Optional adapters (repo, dateCache, notifications). When set, use ports instead of lib.
   */
  constructor(config, deps = {}) {
    this.config = config;
    this.deps = deps;
    this.users = [];
    this.bots = new Map(); // email -> Bot instance
    this.sessions = new Map(); // email -> session headers
    this.lastSheetsRefresh = null;
  }

  /**
   * Initialize users and create bot instances
   * @param {Array<User>} users - Array of users
   */
  async initializeUsers(users) {
    this.users = users;
    this.bots.clear();
    this.sessions.clear();

    log(`Initializing ${users.length} users...`);

    let adapterModule = null;
    try {
      adapterModule = await import('../adapters/index.js');
    } catch (err) {
      log(`Adapters not loaded (expected when running from src): ${formatErrorForLog(err)}`);
    }

    for (const user of users) {
      try {
        const botConfig = {
          email: user.email,
          password: user.password,
          countryCode: user.countryCode,
          scheduleId: user.scheduleId,
          facilityId: this.config.facilityId,
          refreshDelay: this.config.refreshInterval,
          provider: user.provider || 'ais',
          captchaSolver: this.config.captchaSolver || null,
          captchaApiKey: this.config.captcha2CaptchaApiKey || null,
        };

        let client = null;
        if (adapterModule?.createVisaProvider && adapterModule?.ProviderBackedClient) {
          const provider = adapterModule.createVisaProvider(botConfig.provider, {
            captcha2CaptchaApiKey: this.config.captcha2CaptchaApiKey || null,
            captchaSolver: this.config.captchaSolver || null,
          });
          client = new adapterModule.ProviderBackedClient(provider, {
            email: user.email,
            password: user.password,
            countryCode: user.countryCode,
            scheduleId: user.scheduleId,
            facilityId: this.config.facilityId,
          });
        }

        const bot = new Bot(botConfig, client ? { client } : {});
        const sessionHeaders = await bot.initialize();

        this.bots.set(user.email, bot);
        this.sessions.set(user.email, sessionHeaders);

        log(`Initialized bot for user ${user.email}`);
      } catch (error) {
        log(`Failed to initialize bot for user ${user.email}: ${formatErrorForLog(error)}`);
      }
    }

    log(`Initialized ${this.bots.size} bots`);
  }

  /**
   * Check a user using shared cache
   * @param {User} user - User to check
   * @returns {Promise<string|null>} - Available date or null
   */
  async checkUserWithCache(user) {
    const dc = this.deps.dateCache;
    const cacheDeps = dc
      ? {
          getAvailableDates: (p) => dc.getAvailableDates(p),
          isCacheStale: (date, ttl, p) => dc.isCacheStale(date, ttl, p),
          refreshAllDates: (client, headers, scheduleId, facilityId, ttl, p, opts) =>
            dc.refreshAllDates(client, headers, scheduleId, facilityId, ttl, p, opts),
          isDateAvailable: (date, p) => dc.isDateAvailable(date, p),
        }
      : { getAvailableDates, isCacheStale, refreshAllDates, isDateAvailable };
    return checkUserWithCacheUseCase(user, {
      bot: this.bots.get(user.email),
      sessionHeaders: this.sessions.get(user.email),
      config: this.config,
      ...cacheDeps,
      log,
    });
  }

  /**
   * Attempt to book appointment for user
   * @param {User} user - User to book for
   * @param {string} date - Date to book (YYYY-MM-DD)
   * @returns {Promise<boolean>}
   */
  async attemptBooking(user, date) {
    const repo = this.deps.repo;
    const notif = this.deps.notifications;
    const chatId = String(this.config.telegramManagerChatId ?? '');
    const bookingDeps = repo
      ? {
          updateUserCurrentDate: (e, d, t, r) => repo.updateUserCurrentDate(e, d, t, r),
          updateUserLastBooked: (e, d, t, r) => repo.updateUserLastBooked(e, d, t, r),
          logBookingAttempt: (a) => repo.logBookingAttempt(a),
        }
      : {
          updateUserCurrentDate,
          updateUserLastBooked,
          logBookingAttempt,
        };
    const sendNotificationFn = notif
      ? (msg) => notif.send(msg, chatId)
      : (msg) => sendNotification(msg, chatId);
    return attemptBookingUseCase(user, date, {
      bot: this.bots.get(user.email),
      sessionHeaders: this.sessions.get(user.email),
      config: this.config,
      ...bookingDeps,
      sendNotification: sendNotificationFn,
      formatBookingSuccessWithDetails,
      formatBookingFailure,
      log,
    });
  }

  /**
   * Main monitoring loop with rotation
   * @param {Array} [initialCacheEntries] - Preloaded cache entries from getInitialData (avoids 1 read)
   */
  async monitorWithRotation(initialCacheEntries) {
    log('Starting monitoring loop with rotation...');

    const dc = this.deps.dateCache;
    const repo = this.deps.repo;
    const notif = this.deps.notifications;
    const chatId = String(this.config.telegramManagerChatId ?? '');
    const initCache = dc ? () => Promise.resolve() : initializeCache;
    const getStats = dc ? () => dc.getCacheStats() : getCacheStats;
    const sendNotif = notif
      ? (msg, chatIdArg) => notif.send(msg, chatIdArg || chatId)
      : (msg, chatIdArg) => sendNotification(msg, chatIdArg || chatId);

    await startMonitorUseCase(initialCacheEntries, {
      initializeCache: initCache,
      getCacheStats: getStats,
      formatMonitorStarted,
      sendNotification: sendNotif,
      users: this.users,
      config: this.config,
    });

    while (true) {
      try {
        // Refresh users from storage periodically
        const now = new Date();
        if (
          !this.lastSheetsRefresh ||
          (now - this.lastSheetsRefresh) / 1000 > this.config.sheetsRefreshInterval
        ) {
          log('Refreshing users and settings from Google Sheets...');
          try {
            if (repo) {
              const [sheetSettings, freshUsers] = await Promise.all([
                repo.getSettingsOverrides(),
                repo.getActiveUsers(),
              ]);
              Object.assign(this.config, sheetSettings);
              await this.initializeUsers(freshUsers);
              this.lastSheetsRefresh = now;
              log(`Refreshed users: ${freshUsers.length} active users`);
            } else {
              const [sheetSettings, freshUsers] = await Promise.all([
                readSettingsFromSheet(),
                readUsers(),
              ]);
              delete sheetSettings.googleSheetsId;
              delete sheetSettings.googleCredentialsPath;
              Object.assign(this.config, sheetSettings);
              await this.initializeUsers(freshUsers);
              this.lastSheetsRefresh = now;
              log(`Refreshed users: ${freshUsers.length} active users`);
            }
          } catch (error) {
            log(`Failed to refresh users: ${formatErrorForLog(error)}`);
          }
        }

        const user = getNextUser(this.users, this.config.rotationCooldown);

        if (!user) {
          log('No users to check, sleeping...');
          await sleep(this.config.refreshInterval);
          continue;
        }

        log(`Checking user ${user.email}...`);

        const availableDate = await this.checkUserWithCache(user);

        if (availableDate) {
          const slotFoundMsg = formatSlotFound(user, availableDate);
          await sendNotif(slotFoundMsg);
          await this.attemptBooking(user, availableDate);
        } else {
          const logAttempt = repo
            ? (a) => repo.logBookingAttempt(a)
            : logBookingAttempt;
          await logAttempt({
            user_email: user.email,
            date_attempted: null,
            result: 'skipped',
            reason: 'No valid dates found',
          });
        }

        const checkedAt = new Date();
        updateUserPriority(user, checkedAt);
        if (repo) {
          await Promise.all([
            repo.updateUserLastChecked(user.email, checkedAt, user.rowIndex),
            repo.updateUserPriority(user.email, user.priority, user.rowIndex),
          ]);
        } else {
          await Promise.all([
            updateUserLastChecked(user.email, checkedAt, user.rowIndex),
            updateUserPriorityInSheets(user.email, user.priority, user.rowIndex),
          ]);
        }

        await sleep(this.config.refreshInterval);
      } catch (error) {
        log(`Error in monitoring loop: ${formatErrorForLog(error)}`);
        await sleep(this.config.refreshInterval);
      }
    }
  }
}
