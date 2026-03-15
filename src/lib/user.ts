/**
 * Factory to create domain User from raw input (sheet/env).
 * Parsing of date_ranges is done here; domain User holds only parsed data.
 */
import { User } from '../domain/User';
import type { UserConstructorInput } from '../domain/User';
import { parseDateRanges } from './dateParser';
import { formatErrorForLog } from './utils';

/** Raw user input (e.g. from sheet: snake_case, date_ranges as JSON string or array). */
export interface RawUserInput {
  email?: string;
  password?: string;
  country_code?: string;
  schedule_id?: string;
  facility_id?: number | string | null;
  current_date?: string | number | null;
  reaction_time?: number | string;
  date_ranges?: string | Array<{ from?: string; to?: string }>;
  active?: boolean | string;
  last_checked?: string | number | Date | null;
  last_booked?: string | null;
  priority?: number | string;
  provider?: string;
  rowIndex?: number | null;
  vfs_centre?: string;
  vfs_category?: string;
  vfs_subcategory?: string;
  cabinet_link?: string;
}

export function createUser(data: RawUserInput): User {
  const rangesRaw =
    typeof data.date_ranges === 'string'
      ? (() => {
          try {
            return JSON.parse(data.date_ranges) as Array<{ from?: string; to?: string }>;
          } catch (e: unknown) {
            console.error(`Failed to parse date ranges for user ${data.email}:`, formatErrorForLog(e));
            return [];
          }
        })()
      : data.date_ranges ?? [];
  const dateRanges = parseDateRanges(rangesRaw);

  const facilityIdRaw = data.facility_id;
  const facilityId =
    facilityIdRaw !== undefined && facilityIdRaw !== null && facilityIdRaw !== ''
      ? Number(facilityIdRaw)
      : undefined;
  const input: UserConstructorInput = {
    email: data.email ?? '',
    password: data.password ?? '',
    countryCode: data.country_code ?? '',
    scheduleId: data.schedule_id ?? '',
    facilityId: Number.isNaN(facilityId) ? undefined : facilityId,
    currentDate: (data.current_date ?? '').toString().trim().slice(0, 10) || null,
    reactionTime: Number(data.reaction_time) || 0,
    active: data.active === true || data.active === 'true' || data.active === 'TRUE',
    lastChecked: data.last_checked ? new Date(data.last_checked) : null,
    lastBooked: (data.last_booked ?? '').toString().trim().slice(0, 10) || null,
    priority: Number(data.priority) || 0,
    provider: (() => {
      const p = (data.provider ?? 'ais').toString().toLowerCase();
      return p === 'vfs' ? 'vfsglobal' : p;
    })(),
    rowIndex: data.rowIndex != null ? Number(data.rowIndex) : null,
    dateRanges,
    vfsCentre: data.vfs_centre?.toString().trim() || undefined,
    vfsCategory: data.vfs_category?.toString().trim() || undefined,
    vfsSubcategory: data.vfs_subcategory?.toString().trim() || undefined,
    cabinetLink: data.cabinet_link?.toString().trim() || undefined,
  };
  return new User(input);
}

export { User } from '../domain/User';
