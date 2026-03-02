/**
 * Domain user entity: date validation and appointment needs.
 * Implements the User port; instantiate via lib/user createUser() from raw sheet/env input.
 */
import type { User as IUser } from '../ports/User';
import type { ParsedDateRange } from './dateUtils';
import { isDateInRanges, formatDate } from './dateUtils';

/** Input to construct a User (parsed data; parsing is done in lib). */
export interface UserConstructorInput {
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

  constructor(data: UserConstructorInput) {
    this.email = data.email;
    this.password = data.password;
    this.countryCode = data.countryCode;
    this.scheduleId = data.scheduleId;
    this.currentDate = data.currentDate;
    this.reactionTime = data.reactionTime;
    this.active = data.active;
    this.lastChecked = data.lastChecked;
    this.lastBooked = data.lastBooked;
    this.priority = data.priority;
    this.provider = data.provider;
    this.rowIndex = data.rowIndex;
    this.dateRanges = data.dateRanges;
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
              this.dateRanges.map((r) => ({ from: formatDate(r.from), to: formatDate(r.to) }))
            )
          : null,
      active: this.active,
      last_checked: this.lastChecked ? this.lastChecked.toISOString() : null,
      last_booked: this.lastBooked,
      priority: this.priority,
    };
  }
}
