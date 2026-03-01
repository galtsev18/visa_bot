import type { User } from './User.js';

/**
 * Settings overrides read from storage (e.g. Settings sheet).
 * Keys match config property names.
 */
export interface SettingsOverrides {
  telegramBotToken?: string;
  telegramManagerChatId?: string;
  facilityId?: number;
  refreshInterval?: number;
  sheetsRefreshInterval?: number;
  cacheTtl?: number;
  rotationCooldown?: number;
  aisRequestDelaySec?: number;
  aisRateLimitBackoffSec?: number;
  captcha2CaptchaApiKey?: string;
}

/**
 * Booking attempt log entry.
 */
export interface BookingAttemptLog {
  user_email: string;
  date_attempted: string | null;
  time_attempted?: string | null;
  result: 'success' | 'failure' | 'skipped';
  reason?: string;
  old_date?: string | null;
  new_date?: string | null;
  new_time?: string | null;
}

/**
 * Port: user and settings storage (e.g. Google Sheets).
 * All user list, updates, and logs go through this interface.
 * @implemented_by SheetsUserRepository (adapters)
 */
export interface UserRepository {
  getActiveUsers(): Promise<User[]>;

  getSettingsOverrides(): Promise<SettingsOverrides>;

  /** Single batch read: users + cache entries for startup. */
  getInitialData(): Promise<{
    users: User[];
    cacheEntries: Array<{
      provider?: string;
      date: string;
      available?: boolean;
      times_available?: string[] | unknown;
      last_checked?: string;
      cache_valid_until?: string;
    }>;
  }>;

  updateUserLastChecked(
    email: string,
    timestamp: Date,
    rowIndex?: number | null
  ): Promise<void>;

  updateUserCurrentDate(
    email: string,
    newDate: string,
    timeSlot?: string | null,
    rowIndex?: number | null
  ): Promise<void>;

  updateUserLastBooked(
    email: string,
    date: string,
    timeSlot?: string | null,
    rowIndex?: number | null
  ): Promise<void>;

  updateUserPriority(
    email: string,
    priority: number,
    rowIndex?: number | null
  ): Promise<void>;

  logBookingAttempt(attempt: BookingAttemptLog): Promise<void>;

  /** Persist cache entry (date, available, times). Used by DateCache adapter. */
  updateAvailableDate(
    date: string,
    available: boolean,
    times?: string[],
    facilityId?: number
  ): Promise<void>;
}
