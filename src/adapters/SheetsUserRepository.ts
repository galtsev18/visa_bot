import type { User } from '../ports/User.js';
import type {
  UserRepository,
  SettingsOverrides,
  BookingAttemptLog,
} from '../ports/UserRepository.js';
import * as sheets from '../lib/sheets.js';

/**
 * Adapter: Google Sheets as UserRepository.
 * Call initialize(credentialsPath, sheetId) once before other methods.
 */
export class SheetsUserRepository implements UserRepository {
  async initialize(credentialsPath: string, sheetId: string): Promise<void> {
    await sheets.initializeSheets(credentialsPath, sheetId);
  }

  /** Register callback for quota exceeded/resolved (e.g. Telegram alert). */
  setQuotaNotifier(
    fn: (event: 'exceeded' | 'resolved') => void
  ): void {
    sheets.setSheetsQuotaNotifier(fn);
  }

  async getActiveUsers(): Promise<User[]> {
    return sheets.readUsers() as Promise<User[]>;
  }

  async getSettingsOverrides(): Promise<SettingsOverrides> {
    const raw = await sheets.readSettingsFromSheet();
    return raw as SettingsOverrides;
  }

  async getInitialData(): Promise<{
    users: User[];
    cacheEntries: Array<{
      provider?: string;
      date: string;
      available?: boolean;
      times_available?: string[] | unknown;
      last_checked?: string;
      cache_valid_until?: string;
    }>;
  }> {
    return sheets.getInitialData();
  }

  async updateUserLastChecked(
    email: string,
    timestamp: Date,
    rowIndex?: number | null
  ): Promise<void> {
    await sheets.updateUserLastChecked(email, timestamp, rowIndex);
  }

  async updateUserCurrentDate(
    email: string,
    newDate: string,
    timeSlot?: string | null,
    rowIndex?: number | null
  ): Promise<void> {
    await sheets.updateUserCurrentDate(email, newDate, timeSlot, rowIndex);
  }

  async updateUserLastBooked(
    email: string,
    date: string,
    timeSlot?: string | null,
    rowIndex?: number | null
  ): Promise<void> {
    await sheets.updateUserLastBooked(email, date, timeSlot, rowIndex);
  }

  async updateUserPriority(
    email: string,
    priority: number,
    rowIndex?: number | null
  ): Promise<void> {
    await sheets.updateUserPriority(email, priority, rowIndex);
  }

  async logBookingAttempt(attempt: BookingAttemptLog): Promise<void> {
    await sheets.logBookingAttempt(attempt as Parameters<typeof sheets.logBookingAttempt>[0]);
  }

  async updateAvailableDate(
    date: string,
    available: boolean,
    times?: string[],
    facilityId?: number
  ): Promise<void> {
    await sheets.updateAvailableDate(date, available, times ?? [], facilityId ?? 134);
  }
}
