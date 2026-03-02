import type { User as IUser } from '../ports/User';
import type { ParsedDateRange } from './dateParser';
import { parseDateRanges, isDateInRanges, formatDate } from './dateParser';
import { formatErrorForLog } from './utils';

/** Raw user input (e.g. from sheet: snake_case, date_ranges as JSON string or array). */
export interface RawUserInput {
  email?: string;
  password?: string;
  country_code?: string;
  schedule_id?: string;
  current_date?: string | number | null;
  reaction_time?: number | string;
  date_ranges?: string | Array<{ from?: string; to?: string }>;
  active?: boolean | string;
  last_checked?: string | number | Date | null;
  last_booked?: string | null;
  priority?: number | string;
  provider?: string;
  rowIndex?: number | null;
}

export class User implements IUser {
  email: string;
  password: string;
  countryCode: string;
  scheduleId: string;
  currentDate: string | null;
  reactionTime: number;
  active: boolean;
  lastChecked: Date | null;
  lastBooked: string | null;
  priority: number;
  provider: string;
  rowIndex: number | null;
  dateRanges: ParsedDateRange[];

  constructor(data: RawUserInput) {
    this.email = data.email ?? '';
    this.password = data.password ?? '';
    this.countryCode = data.country_code ?? '';
    this.scheduleId = data.schedule_id ?? '';
    this.currentDate = (data.current_date ?? '').toString().trim().slice(0, 10) || null;
    this.reactionTime = Number(data.reaction_time) || 0;
    this.active = data.active === true || data.active === 'true' || data.active === 'TRUE';
    this.lastChecked = data.last_checked ? new Date(data.last_checked) : null;
    this.lastBooked = (data.last_booked ?? '').toString().trim().slice(0, 10) || null;
    this.priority = Number(data.priority) || 0;
    this.provider = (data.provider ?? 'ais').toLowerCase();
    this.rowIndex = data.rowIndex != null ? Number(data.rowIndex) : null;

    let dateRanges: ParsedDateRange[] = [];
    if (data.date_ranges) {
      try {
        const rangesJson =
          typeof data.date_ranges === 'string' ? JSON.parse(data.date_ranges) : data.date_ranges;
        dateRanges = parseDateRanges(rangesJson);
      } catch (e: unknown) {
        console.error(`Failed to parse date ranges for user ${this.email}:`, formatErrorForLog(e));
      }
    }
    this.dateRanges = dateRanges;
  }

  isDateAfterReactionTime(date: Date | string): boolean {
    if (this.reactionTime <= 0) return true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + this.reactionTime);

    const dateObj: Date = date instanceof Date ? date : new Date(date + 'T00:00:00');
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return false;
    dateObj.setHours(0, 0, 0, 0);
    return dateObj >= minDate;
  }

  isDateInRange(date: Date | string): boolean {
    return isDateInRanges(date, this.dateRanges);
  }

  isDateEarlierThanCurrent(date: Date | string): boolean {
    if (!this.currentDate) return true;

    const dateObj: Date = date instanceof Date ? date : new Date(date + 'T00:00:00');
    const currentDateObj = new Date(this.currentDate + 'T00:00:00');
    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return false;
    dateObj.setHours(0, 0, 0, 0);
    currentDateObj.setHours(0, 0, 0, 0);
    return dateObj < currentDateObj;
  }

  isDateValid(date: Date | string): boolean {
    return (
      this.isDateEarlierThanCurrent(date) &&
      this.isDateInRange(date) &&
      this.isDateAfterReactionTime(date)
    );
  }

  needsAppointment(): boolean {
    if (!this.currentDate) return true;
    return !this.isDateInRange(this.currentDate);
  }

  getMinBookingDate(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + this.reactionTime);
    return minDate;
  }

  toObject(): {
    email: string;
    password: string;
    country_code: string;
    schedule_id: string;
    current_date: string | null;
    reaction_time: number;
    date_ranges: string | null;
    active: boolean;
    last_checked: string | null;
    last_booked: string | null;
    priority: number;
  } {
    return {
      email: this.email,
      password: this.password,
      country_code: this.countryCode,
      schedule_id: this.scheduleId,
      current_date: this.currentDate,
      reaction_time: this.reactionTime,
      date_ranges:
        this.dateRanges.length > 0
          ? JSON.stringify(
              this.dateRanges.map((r) => ({
                from: formatDate(r.from),
                to: formatDate(r.to),
              }))
            )
          : null,
      active: this.active,
      last_checked: this.lastChecked ? this.lastChecked.toISOString() : null,
      last_booked: this.lastBooked,
      priority: this.priority,
    };
  }
}
