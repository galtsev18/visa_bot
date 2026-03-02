/**
 * Shared types for application use cases (deps and minimal user shapes).
 */

export interface CacheEntry {
  provider?: string;
  date: string;
  available?: boolean;
  times_available?: string[];
  last_checked?: string;
  cache_valid_until?: string;
}

export interface StartMonitorDeps {
  initializeCache: (entries: CacheEntry[] | undefined) => Promise<void>;
  getCacheStats: () => {
    total: number;
    providers: Record<string, { entries: number; available: number }>;
  };
  formatMonitorStarted: (
    users: unknown[],
    config: { telegramManagerChatId?: string },
    stats: ReturnType<StartMonitorDeps['getCacheStats']>
  ) => string;
  sendNotification: (msg: string, chatId: string) => Promise<unknown>;
  users: unknown[];
  config: { telegramManagerChatId?: string };
}

export interface CheckUserUser {
  email: string;
  provider?: string;
  scheduleId: string;
  isDateValid(date: string): boolean;
}

export interface CheckUserWithCacheDeps {
  bot: {
    client: {
      checkAvailableDate: (
        headers: Record<string, unknown> | Record<string, string>,
        scheduleId: string,
        facilityId: number | string
      ) => Promise<string[]>;
      checkAvailableTime: (
        headers: Record<string, unknown> | Record<string, string>,
        scheduleId: string,
        facilityId: number | string,
        date: string
      ) => Promise<string | null>;
    };
  } | null;
  sessionHeaders: Record<string, unknown> | null;
  config: {
    cacheTtl: number;
    facilityId: number;
    aisRequestDelaySec?: number;
    aisRateLimitBackoffSec?: number;
  };
  getAvailableDates: (provider: string) => string[];
  isCacheStale: (date: string, ttl: number, provider: string) => boolean;
  refreshAllDates: (
    client: import('../ports/DateCache').DateCacheClient,
    headers: Record<string, unknown>,
    scheduleId: string,
    facilityId: number,
    ttl: number,
    provider: string,
    opts?: { requestDelaySec?: number; rateLimitBackoffSec?: number }
  ) => Promise<string[]>;
  isDateAvailable: (date: string, provider: string) => boolean;
  log: (msg: string) => void;
}

export interface AttemptBookingUser {
  email: string;
  currentDate: string | null;
  lastBooked: string | null;
  rowIndex?: number | null;
}

export interface AttemptBookingDeps {
  bot: {
    bookAppointment: (
      headers: Record<string, unknown> | Record<string, string>,
      date: string
    ) => Promise<{ success: boolean; time?: string } | null>;
  } | null;
  sessionHeaders: Record<string, unknown> | null;
  config: { telegramManagerChatId?: string };
  updateUserCurrentDate: (
    email: string,
    date: string,
    timeSlot: string | null,
    rowIndex?: number | null
  ) => Promise<void>;
  updateUserLastBooked: (
    email: string,
    date: string,
    timeSlot: string | null,
    rowIndex?: number | null
  ) => Promise<void>;
  logBookingAttempt: (attempt: {
    user_email: string;
    date_attempted?: string | null;
    time_attempted?: string | null;
    result: string;
    reason?: string;
    old_date?: string | null;
    new_date?: string | null;
    new_time?: string | null;
  }) => Promise<void>;
  sendNotification: (msg: string, chatId: string) => Promise<unknown>;
  formatBookingSuccessWithDetails: (
    user: unknown,
    oldDate: string | null,
    newDate: string,
    timeSlot: string | null
  ) => string;
  formatBookingFailure: (user: unknown, date: string, reason: string) => string;
  log: (msg: string) => void;
}
