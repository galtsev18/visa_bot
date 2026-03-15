/**
 * Domain user (from repository).
 * rowIndex is 1-based sheet row when source is Sheets.
 */
export interface UserData {
  email: string;
  password: string;
  countryCode: string;
  scheduleId: string;
  /** AIS only: facility ID (optional; overrides global config when set) */
  facilityId?: number | null;
  currentDate: string | null;
  reactionTime: number;
  dateRanges: Array<{ from: Date; to: Date }>;
  active: boolean;
  lastChecked: Date | null;
  lastBooked: string | null;
  priority: number;
  /** Provider: 'ais' | 'vfsglobal'; engine uses this to choose AIS or VFS */
  provider: string;
  rowIndex?: number | null;
  /** VFS only: visa centre (dropdown text on VFS site) */
  vfsCentre?: string;
  /** VFS only: visa category (e.g. type of visa) */
  vfsCategory?: string;
  /** VFS only: visa subcategory */
  vfsSubcategory?: string;
  /** VFS only: login page URL from sheet (cabinet_link) */
  cabinetLink?: string;
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
