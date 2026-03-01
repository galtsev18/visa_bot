/**
 * Domain user (from repository).
 * rowIndex is 1-based sheet row when source is Sheets.
 */
export interface UserData {
  email: string;
  password: string;
  countryCode: string;
  scheduleId: string;
  currentDate: string | null;
  reactionTime: number;
  dateRanges: Array<{ from: Date; to: Date }>;
  active: boolean;
  lastChecked: Date | null;
  lastBooked: string | null;
  priority: number;
  provider: string;
  rowIndex?: number | null;
}

/**
 * User with behavior (date validation, needsAppointment).
 * Implementations can be a class that parses from UserData.
 */
export interface User extends UserData {
  isDateValid(date: string | Date): boolean;
  needsAppointment(): boolean;
  isDateEarlierThanCurrent(date: string | Date): boolean;
  isDateInRange(date: string | Date): boolean;
  isDateAfterReactionTime(date: string | Date): boolean;
}
