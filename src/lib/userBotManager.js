import { Bot } from './bot.js';
import { getNextUser, updateUserPriority } from './userRotation.js';
import {
  getAvailableDates,
  isDateAvailable,
  isCacheStale,
  refreshAllDates,
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

export class UserBotManager {
  constructor(config) {
    this.config = config;
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
      log(`Adapters not loaded (expected when running from src): ${err.message}`);
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
    const bot = this.bots.get(user.email);
    const sessionHeaders = this.sessions.get(user.email);

    if (!bot || !sessionHeaders) {
      const parts = [];
      if (!bot) parts.push('bot not initialized');
      if (!sessionHeaders) parts.push('session not initialized (not logged in)');
      log(
        `User ${user.email}: ${parts.join(', ')} — skipping date check (login may have failed at startup)`
      );
      return null;
    }

    // Check if cache needs refresh
    const provider = user.provider || 'ais';
    const availableDates = getAvailableDates(provider);

    if (
      availableDates.length === 0 ||
      availableDates.some((date) => isCacheStale(date, this.config.cacheTtl, provider))
    ) {
      log(`Refreshing date cache for user ${user.email} (${provider})...`);
      try {
        await refreshAllDates(
          bot.client,
          sessionHeaders,
          user.scheduleId,
          this.config.facilityId,
          this.config.cacheTtl,
          provider,
          {
            requestDelaySec: this.config.aisRequestDelaySec,
            rateLimitBackoffSec: this.config.aisRateLimitBackoffSec,
          }
        );
        const refreshedDates = getAvailableDates(provider);
        availableDates.length = 0;
        availableDates.push(...refreshedDates);
      } catch (error) {
        log(`Failed to refresh cache: ${error.message}`);
      }
    }

    // Filter dates for this user
    const validDates = availableDates.filter((date) => {
      if (!user.isDateValid(date)) {
        return false;
      }
      return isDateAvailable(date, provider);
    });

    if (validDates.length === 0) {
      log(`No valid dates found for user ${user.email}`);
      return null;
    }

    // Return earliest valid date
    validDates.sort();
    const selectedDate = validDates[0];
    log(`Found valid date ${selectedDate} for user ${user.email}`);

    return selectedDate;
  }

  /**
   * Attempt to book appointment for user
   * @param {User} user - User to book for
   * @param {string} date - Date to book (YYYY-MM-DD)
   * @returns {Promise<boolean>}
   */
  async attemptBooking(user, date) {
    const bot = this.bots.get(user.email);
    const sessionHeaders = this.sessions.get(user.email);

    if (!bot || !sessionHeaders) {
      const parts = [];
      if (!bot) parts.push('bot not initialized');
      if (!sessionHeaders) parts.push('session not initialized (not logged in)');
      const reason = `Cannot book: ${parts.join(', ')} for ${user.email} (login may have failed at startup)`;
      await logBookingAttempt({
        user_email: user.email,
        date_attempted: date,
        result: 'failure',
        reason,
      });
      log(`User ${user.email}: ${reason}`);
      return false;
    }

    try {
      const oldDate = user.currentDate;
      const result = await bot.bookAppointment(sessionHeaders, date);

      if (result && result.success) {
        await this.handleBookingSuccess(user, oldDate, date, result.time);
        return true;
      } else {
        await this.handleBookingFailure(user, date, 'Booking failed - no time slot available');
        return false;
      }
    } catch (error) {
      await this.handleBookingFailure(user, date, error.message);
      return false;
    }
  }

  /**
   * Handle successful booking
   * @param {User} user - User object
   * @param {string} oldDate - Previous appointment date
   * @param {string} newDate - New appointment date
   * @param {string} [timeSlot] - Booked time slot (e.g. "09:00")
   */
  async handleBookingSuccess(user, oldDate, newDate, timeSlot = null) {
    log(
      `Booking successful for ${user.email}: ${oldDate} -> ${newDate}${timeSlot ? ` ${timeSlot}` : ''}`
    );

    // Update user
    user.currentDate = newDate;
    user.lastBooked = newDate;

    // Update in Sheets (with time so spreadsheet shows date and time)
    await Promise.all([
      updateUserCurrentDate(user.email, newDate, timeSlot, user.rowIndex),
      updateUserLastBooked(user.email, newDate, timeSlot, user.rowIndex),
      logBookingAttempt({
        user_email: user.email,
        date_attempted: newDate,
        time_attempted: timeSlot,
        result: 'success',
        reason: 'Appointment booked successfully',
        old_date: oldDate,
        new_date: newDate,
        new_time: timeSlot,
      }),
    ]);

    // Send Telegram notification with details (including time slot if available)
    const message = formatBookingSuccessWithDetails(user, oldDate, newDate, timeSlot);
    await sendNotification(message, this.config.telegramManagerChatId);
  }

  /**
   * Handle booking failure
   * @param {User} user - User object
   * @param {string} date - Date that was attempted
   * @param {string} reason - Failure reason
   */
  async handleBookingFailure(user, date, reason) {
    log(`Booking failed for ${user.email} on ${date}: ${reason}`);

    await logBookingAttempt({
      user_email: user.email,
      date_attempted: date,
      result: 'failure',
      reason: reason,
    });

    // Send Telegram notification with details
    const message = formatBookingFailure(user, date, reason);
    await sendNotification(message, this.config.telegramManagerChatId);
  }

  /**
   * Main monitoring loop with rotation
   * @param {Array} [initialCacheEntries] - Preloaded cache entries from getInitialData (avoids 1 read)
   */
  async monitorWithRotation(initialCacheEntries) {
    log('Starting monitoring loop with rotation...');

    await initializeCache(initialCacheEntries);

    // Notify manager that monitor started (pool size, cache stats, settings)
    const cacheStats = getCacheStats();
    const startedMsg = formatMonitorStarted(this.users, this.config, cacheStats);
    await sendNotification(startedMsg, this.config.telegramManagerChatId);

    while (true) {
      try {
        // Refresh users from Sheets periodically
        const now = new Date();
        if (
          !this.lastSheetsRefresh ||
          (now - this.lastSheetsRefresh) / 1000 > this.config.sheetsRefreshInterval
        ) {
          log('Refreshing users and settings from Google Sheets...');
          try {
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
          } catch (error) {
            log(`Failed to refresh users: ${error.message}`);
          }
        }

        // Get next user to check
        const user = getNextUser(this.users, this.config.rotationCooldown);

        if (!user) {
          log('No users to check, sleeping...');
          await sleep(this.config.refreshInterval);
          continue;
        }

        log(`Checking user ${user.email}...`);

        // Check for available dates
        const availableDate = await this.checkUserWithCache(user);

        if (availableDate) {
          // Notify: matching slot found, attempting to book
          const slotFoundMsg = formatSlotFound(user, availableDate);
          await sendNotification(slotFoundMsg, this.config.telegramManagerChatId);
          // Attempt booking
          await this.attemptBooking(user, availableDate);
        } else {
          // Log that no valid date was found
          await logBookingAttempt({
            user_email: user.email,
            date_attempted: null,
            result: 'skipped',
            reason: 'No valid dates found',
          });
        }

        // Update user metadata
        const checkedAt = new Date();
        updateUserPriority(user, checkedAt);
        await Promise.all([
          updateUserLastChecked(user.email, checkedAt, user.rowIndex),
          updateUserPriorityInSheets(user.email, user.priority, user.rowIndex),
        ]);

        // Sleep before next iteration
        await sleep(this.config.refreshInterval);
      } catch (error) {
        log(`Error in monitoring loop: ${error.message}`);
        await sleep(this.config.refreshInterval);
      }
    }
  }
}
