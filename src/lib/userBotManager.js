import { Bot } from './bot.js';
import { User } from './user.js';
import { getNextUser, updateUserPriority } from './userRotation.js';
import { 
  getAvailableDates, 
  isDateAvailable, 
  isCacheStale, 
  refreshAllDates,
  initializeCache 
} from './dateCache.js';
import { 
  readUsers,
  updateUserLastChecked, 
  updateUserCurrentDate, 
  updateUserLastBooked,
  updateUserPriority as updateUserPriorityInSheets,
  logBookingAttempt 
} from './sheets.js';
import { sendNotification, formatBookingSuccess, formatError } from './telegram.js';
import { log, sleep } from './utils.js';
import { getConfig } from './config.js';

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

    for (const user of users) {
      try {
        const botConfig = {
          email: user.email,
          password: user.password,
          countryCode: user.countryCode,
          scheduleId: user.scheduleId,
          facilityId: this.config.facilityId,
          refreshDelay: this.config.refreshInterval
        };

        const bot = new Bot(botConfig);
        const sessionHeaders = await bot.initialize();

        this.bots.set(user.email, bot);
        this.sessions.set(user.email, sessionHeaders);

        log(`Initialized bot for user ${user.email}`);
      } catch (error) {
        log(`Failed to initialize bot for user ${user.email}: ${error.message}`);
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
      log(`Bot or session not found for user ${user.email}`);
      return null;
    }

    // Check if cache needs refresh
    const availableDates = getAvailableDates();
    
    if (availableDates.length === 0 || availableDates.some(date => isCacheStale(date, this.config.cacheTtl))) {
      log(`Refreshing date cache for user ${user.email}...`);
      try {
        await refreshAllDates(
          bot.client,
          sessionHeaders,
          user.scheduleId,
          this.config.facilityId,
          this.config.cacheTtl
        );
        // Re-get available dates after refresh
        const refreshedDates = getAvailableDates();
        availableDates.push(...refreshedDates);
      } catch (error) {
        log(`Failed to refresh cache: ${error.message}`);
      }
    }

    // Filter dates for this user
    const validDates = availableDates.filter(date => {
      if (!user.isDateValid(date)) {
        return false;
      }
      return isDateAvailable(date);
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
      await logBookingAttempt({
        user_email: user.email,
        date_attempted: date,
        result: 'failure',
        reason: 'Bot or session not found'
      });
      return false;
    }

    try {
      const oldDate = user.currentDate;
      const booked = await bot.bookAppointment(sessionHeaders, date);

      if (booked) {
        await this.handleBookingSuccess(user, oldDate, date);
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
   */
  async handleBookingSuccess(user, oldDate, newDate) {
    log(`Booking successful for ${user.email}: ${oldDate} -> ${newDate}`);

    // Update user
    user.currentDate = newDate;
    user.lastBooked = newDate;

    // Update in Sheets
    await Promise.all([
      updateUserCurrentDate(user.email, newDate),
      updateUserLastBooked(user.email, newDate),
      logBookingAttempt({
        user_email: user.email,
        date_attempted: newDate,
        result: 'success',
        reason: 'Appointment booked successfully',
        old_date: oldDate,
        new_date: newDate
      })
    ]);

    // Send Telegram notification
    const message = formatBookingSuccess(user, oldDate, newDate);
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
      reason: reason
    });
  }

  /**
   * Main monitoring loop with rotation
   */
  async monitorWithRotation() {
    log('Starting monitoring loop with rotation...');

    // Initialize cache
    await initializeCache();

    while (true) {
      try {
        // Refresh users from Sheets periodically
        const now = new Date();
        if (!this.lastSheetsRefresh || 
            (now - this.lastSheetsRefresh) / 1000 > this.config.sheetsRefreshInterval) {
          log('Refreshing users from Google Sheets...');
          try {
            const freshUsers = await readUsers();
            // Re-initialize bots for new/updated users
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
          // Attempt booking
          await this.attemptBooking(user, availableDate);
        } else {
          // Log that no valid date was found
          await logBookingAttempt({
            user_email: user.email,
            date_attempted: null,
            result: 'skipped',
            reason: 'No valid dates found'
          });
        }

        // Update user metadata
        const checkedAt = new Date();
        updateUserPriority(user, checkedAt);
        await Promise.all([
          updateUserLastChecked(user.email, checkedAt),
          updateUserPriorityInSheets(user.email, user.priority)
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
