import { google } from 'googleapis';
import { log, sleep, formatErrorForLog } from './utils';
import { User } from './user';

type SheetsV4 = ReturnType<typeof google.sheets>;

let sheets: SheetsV4 | null = null;
let spreadsheetId: string | null = null;

const SHEET_USERS = 'Users';
const SHEET_CACHE = 'Available Dates Cache';
const SHEET_LOGS = 'Booking Attempts Log';
const SHEET_SETTINGS = 'Settings';

let usersHeaderCache: string[] | null = null;
const emailToRowIndex = new Map<string, number>();
const cacheDateToRowIndex = new Map<string, number>();

const QUOTA_RETRY_WAIT_SEC = 65;
let quotaExceededNotified = false;
let quotaNotifier: ((event: 'exceeded' | 'resolved') => void) | null = null;

export function setSheetsQuotaNotifier(fn: (event: 'exceeded' | 'resolved') => void): void {
  quotaNotifier = fn;
}

function isQuotaError(err: unknown): boolean {
  const e = err as { message?: string; response?: { status?: number } } | undefined;
  const msg = e?.message ?? '';
  return (
    e?.response?.status === 429 ||
    msg.includes('Quota exceeded') ||
    msg.includes('quota metric')
  );
}

async function withQuotaRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    if (quotaExceededNotified && quotaNotifier) {
      quotaNotifier('resolved');
      quotaExceededNotified = false;
    }
    return result;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    if (!quotaExceededNotified && quotaNotifier) {
      quotaNotifier('exceeded');
      quotaExceededNotified = true;
    }
    log(`Sheets API quota exceeded. Waiting ${QUOTA_RETRY_WAIT_SEC}s before retry...`);
    await sleep(QUOTA_RETRY_WAIT_SEC);
    const result = await fn();
    if (quotaNotifier) {
      quotaNotifier('resolved');
      quotaExceededNotified = false;
    }
    return result;
  }
}

function formatDateTimeForSheet(
  dateStr: string | null | undefined,
  timeStr?: string | null
): string {
  const d = (dateStr || '').toString().trim().slice(0, 10);
  if (!d) return '';
  const t = timeStr && timeStr.toString().trim() ? timeStr.toString().trim().slice(0, 5) : '00:00';
  return `${d} ${t}`;
}

function columnIndexToLetter(index: number): string {
  let result = '';
  index++;
  while (index > 0) {
    index--;
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

async function ensureSheetsExist(): Promise<void> {
  if (!sheets || !spreadsheetId) throw new Error('Sheets not initialized');
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = (spreadsheet.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter(Boolean);
  const required = [SHEET_USERS, SHEET_CACHE, SHEET_LOGS, SHEET_SETTINGS];
  const missing = required.filter((name) => !existingTitles.includes(name));
  if (missing.length === 0) return;
  log(`Creating ${missing.length} sheet(s): ${missing.join(', ')}...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: missing.map((sheetName) => ({
        addSheet: { properties: { title: sheetName } },
      })),
    },
  });
  missing.forEach((name) => log(`✅ Created sheet "${name}"`));
}

export async function initializeSheets(
  credentialsPath: string,
  sheetId: string
): Promise<boolean> {
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheets = google.sheets({ version: 'v4', auth });
  spreadsheetId = sheetId;
  log('Google Sheets initialized');

  return withQuotaRetry(async () => {
    await ensureSheetsExist();
    await ensureHeaders();
    return true;
  }).catch((error) => {
    log(`Failed to initialize Google Sheets: ${formatErrorForLog(error)}`);
    throw error;
  });
}

const USERS_HEADERS = [
  'email',
  'password',
  'country_code',
  'schedule_id',
  'current_date',
  'reaction_time',
  'date_ranges',
  'active',
  'last_checked',
  'last_booked',
  'priority',
  'provider',
];
const CACHE_HEADERS = [
  'date',
  'facility_id',
  'available',
  'last_checked',
  'times_available',
  'cache_valid_until',
];
const LOGS_HEADERS = [
  'timestamp',
  'user_email',
  'date_attempted',
  'result',
  'reason',
  'old_date',
  'new_date',
];
const SETTINGS_HEADERS = ['key', 'value'];

async function ensureHeaders(): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  try {
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        `${SHEET_USERS}!1:1`,
        `${SHEET_CACHE}!1:1`,
        `${SHEET_LOGS}!1:1`,
        `${SHEET_SETTINGS}!1:1`,
      ],
    });

    const valueRanges = batch.data.valueRanges ?? [];
    const usersRow = valueRanges[0]?.values?.[0] as string[] | undefined;
    const cacheRow = valueRanges[1]?.values?.[0] as string[] | undefined;
    const logsRow = valueRanges[2]?.values?.[0] as string[] | undefined;
    const settingsRow = valueRanges[3]?.values?.[0] as string[] | undefined;

    if (usersRow && usersRow.length > 0) usersHeaderCache = usersRow;

    const updates: { range: string; values: string[][] }[] = [];
    if (!usersRow || usersRow.length === 0) {
      updates.push({ range: `${SHEET_USERS}!1:1`, values: [USERS_HEADERS] });
      usersHeaderCache = USERS_HEADERS;
    }
    if (!cacheRow || cacheRow.length === 0) {
      updates.push({ range: `${SHEET_CACHE}!1:1`, values: [CACHE_HEADERS] });
    }
    if (!logsRow || logsRow.length === 0) {
      updates.push({ range: `${SHEET_LOGS}!1:1`, values: [LOGS_HEADERS] });
    }
    const settingsValid =
      settingsRow &&
      settingsRow.length >= 2 &&
      String(settingsRow[0] ?? '').toLowerCase().trim() === 'key' &&
      String(settingsRow[1] ?? '').toLowerCase().trim() === 'value';
    if (!settingsValid) {
      updates.push({ range: `${SHEET_SETTINGS}!1:1`, values: [SETTINGS_HEADERS] });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates,
        },
      });
      updates.forEach((u) => log(`Created headers for ${u.range.split('!')[0]}`));
    }

    log('All sheet headers verified/created');
  } catch (error) {
    const e = error as { message?: string; response?: { status?: number } };
    if (
      e.message?.includes('Unable to parse range') ||
      e.response?.status === 400
    ) {
      log('⚠️  Warning: One or more sheets may not exist.');
      log(
        'Required sheets: 1. "Users"  2. "Available Dates Cache"  3. "Booking Attempts Log"  4. "Settings"'
      );
    } else {
      log(`⚠️  Warning: Failed to ensure headers: ${formatErrorForLog(error)}`);
    }
  }
}

const SETTINGS_KEY_MAP: Record<
  string,
  { configKey: string; number: boolean }
> = {
  AIS_REQUEST_DELAY_SEC: { configKey: 'aisRequestDelaySec', number: true },
  AIS_RATE_LIMIT_BACKOFF_SEC: { configKey: 'aisRateLimitBackoffSec', number: true },
  REFRESH_INTERVAL: { configKey: 'refreshInterval', number: true },
  SHEETS_REFRESH_INTERVAL: { configKey: 'sheetsRefreshInterval', number: true },
  CACHE_TTL: { configKey: 'cacheTtl', number: true },
  ROTATION_COOLDOWN: { configKey: 'rotationCooldown', number: true },
  TELEGRAM_BOT_TOKEN: { configKey: 'telegramBotToken', number: false },
  TELEGRAM_MANAGER_CHAT_ID: { configKey: 'telegramManagerChatId', number: false },
  FACILITY_ID: { configKey: 'facilityId', number: true },
  CAPTCHA_2CAPTCHA_API_KEY: { configKey: 'captcha2CaptchaApiKey', number: false },
};

const SETTINGS_DEFAULT_VALUES: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_MANAGER_CHAT_ID: '',
  FACILITY_ID: '134',
  REFRESH_INTERVAL: '3',
  SHEETS_REFRESH_INTERVAL: '300',
  CACHE_TTL: '60',
  ROTATION_COOLDOWN: '30',
  AIS_REQUEST_DELAY_SEC: '2',
  AIS_RATE_LIMIT_BACKOFF_SEC: '30',
  CAPTCHA_2CAPTCHA_API_KEY: '',
};

export async function readSettingsFromSheet(): Promise<Record<string, unknown>> {
  if (!sheets || !spreadsheetId) return {};
  return withQuotaRetry(async () => {
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_SETTINGS}!A1:B500`,
    });
    const rows = (response.data.values ?? []) as (string | number)[][];
    if (rows.length < 1) return {};

    const headerKey = String(rows[0][0] ?? '').toLowerCase().trim();
    const headerVal = String(rows[0][1] ?? '').toLowerCase().trim();
    if (headerKey !== 'key' || headerVal !== 'value') {
      log('Settings sheet: invalid structure (expected key, value). Fixing headers.');
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_SETTINGS}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [SETTINGS_HEADERS] },
      });
      return {};
    }

    const overrides: Record<string, unknown> = {};
    const existingKeys = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const k = String((rows[i] ?? [])[0] ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');
      if (k) existingKeys.add(k);
    }
    const allKeys = Object.keys(SETTINGS_KEY_MAP);
    const missingKeys = allKeys.filter((k) => !existingKeys.has(k));
    if (missingKeys.length > 0) {
      const appendRows = missingKeys.map((k) => [k, SETTINGS_DEFAULT_VALUES[k] ?? '']);
      await sheets!.spreadsheets.values.append({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_SETTINGS}!A:B`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appendRows },
      });
      log(`Settings: added missing keys: ${missingKeys.join(', ')}`);
      for (const k of missingKeys) {
        const mapping = SETTINGS_KEY_MAP[k];
        const raw = SETTINGS_DEFAULT_VALUES[k] ?? '';
        const value = mapping.number ? Number(raw) : raw != null ? String(raw).trim() : '';
        if (!mapping.number || (!Number.isNaN(value as number) && value !== undefined)) {
          overrides[mapping.configKey] = value;
        }
      }
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as (string | number)[];
      if (!row || row.length < 1) continue;
      const key = String(row[0] ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');
      const raw = row[1];
      if (!key) continue;
      const mapping = SETTINGS_KEY_MAP[key];
      if (!mapping) continue;
      if (mapping.configKey === 'googleSheetsId' || mapping.configKey === 'googleCredentialsPath')
        continue;
      const value = mapping.number ? Number(raw) : raw != null ? String(raw).trim() : '';
      if (mapping.number && (value === undefined || Number.isNaN(value as number))) continue;
      overrides[mapping.configKey] = value;
    }
    if (Object.keys(overrides).length > 0) {
      log(`Settings from sheet: ${Object.keys(overrides).join(', ')}`);
    }
    return overrides;
  }).catch((error) => {
    log(`Failed to read Settings sheet: ${formatErrorForLog(error)}`);
    return {};
  });
}

export async function readUsers(): Promise<User[]> {
  if (!sheets || !spreadsheetId) return [];
  return withQuotaRetry(async () => {
    emailToRowIndex.clear();
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_USERS}!A1:Z1000`,
    });

    const rows = response.data.values as (string | number)[][] | undefined;
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map((h) => String(h).toLowerCase().replace(/\s+/g, '_'));
    const users: User[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const userData: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        userData[header] = row[index] ?? '';
      });

      if (userData.active === true || userData.active === 'true' || userData.active === 'TRUE') {
        try {
          const oneBasedRow = i + 1;
          (userData as Record<string, unknown>).rowIndex = oneBasedRow;
          const user = new User(userData as import('./user').RawUserInput);
          users.push(user);
          emailToRowIndex.set(user.email, oneBasedRow);
        } catch (error) {
          log(`Failed to parse user ${userData.email}: ${formatErrorForLog(error)}`);
        }
      }
    }

    log(`Read ${users.length} active users from Google Sheets`);
    return users;
  }).catch((error) => {
    log(`Failed to read users from Google Sheets: ${formatErrorForLog(error)}`);
    throw error;
  });
}

export interface CacheEntryFromSheet {
  date: string;
  facility_id?: string | number;
  available?: boolean | string;
  times_available?: string | string[];
  last_checked?: string;
  cache_valid_until?: string;
  provider?: string;
}

export async function getInitialData(): Promise<{
  users: User[];
  cacheEntries: CacheEntryFromSheet[];
}> {
  if (!sheets || !spreadsheetId) return { users: [], cacheEntries: [] };
  return withQuotaRetry(async () => {
    const batch = await sheets!.spreadsheets.values.batchGet({
      spreadsheetId: spreadsheetId!,
      ranges: [`${SHEET_USERS}!A1:Z1000`, `${SHEET_CACHE}!A1:F1000`],
    });
    const valueRanges = batch.data.valueRanges ?? [];
    const usersRows = (valueRanges[0]?.values ?? []) as (string | number)[][];
    const cacheRows = (valueRanges[1]?.values ?? []) as (string | number)[][];

    emailToRowIndex.clear();
    cacheDateToRowIndex.clear();

    const users: User[] = [];
    if (usersRows.length >= 2) {
      const headers = usersRows[0].map((h) => String(h).toLowerCase().replace(/\s+/g, '_'));
      usersHeaderCache = usersRows[0].map(String);
      for (let i = 1; i < usersRows.length; i++) {
        const row = usersRows[i];
        if (!row || row.length === 0) continue;
        const userData: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          userData[header] = row[index] ?? '';
        });
        if (userData.active !== true && userData.active !== 'true' && userData.active !== 'TRUE')
          continue;
        try {
          const oneBasedRow = i + 1;
          (userData as Record<string, unknown>).rowIndex = oneBasedRow;
          const user = new User(userData as import('./user').RawUserInput);
          users.push(user);
          emailToRowIndex.set(user.email, oneBasedRow);
        } catch (err) {
          log(`Failed to parse user ${userData.email}: ${formatErrorForLog(err)}`);
        }
      }
    }

    const cacheEntries: CacheEntryFromSheet[] = [];
    if (cacheRows.length >= 2) {
      const headers = cacheRows[0].map((h) => String(h).toLowerCase().replace(/\s+/g, '_'));
      for (let i = 1; i < cacheRows.length; i++) {
        const row = cacheRows[i];
        if (!row || row.length === 0) continue;
        const entry: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          entry[header] = row[index] ?? '';
        });
        if (entry.date) entry.date = (entry.date + '').toString().trim().slice(0, 10);
        if (entry.times_available) {
          try {
            entry.times_available = JSON.parse(entry.times_available as string);
          } catch (err) {
            log(`Parse times_available JSON failed: ${formatErrorForLog(err)}`);
            entry.times_available = [];
          }
        }
        entry.available = entry.available === 'TRUE' || entry.available === true;
        if (entry.date) {
          cacheEntries.push(entry as unknown as CacheEntryFromSheet);
          cacheDateToRowIndex.set(entry.date as string, i + 1);
        }
      }
    }

    log(`Initial data: ${users.length} users, ${cacheEntries.length} cache entries (1 batch read)`);
    return { users, cacheEntries };
  }).catch((error) => {
    log(`Failed to get initial data: ${formatErrorForLog(error)}`);
    throw error;
  });
}

export async function readAvailableDatesCache(): Promise<CacheEntryFromSheet[]> {
  if (!sheets || !spreadsheetId) return [];
  return withQuotaRetry(async () => {
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_CACHE}!A1:F1000`,
    });

    const rows = response.data.values as (string | number)[][] | undefined;
    if (!rows || rows.length < 2) return [];

    const headers = rows[0].map((h) => String(h).toLowerCase().replace(/\s+/g, '_'));
    const cache: CacheEntryFromSheet[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const entry: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] ?? '';
      });
      if (entry.date) entry.date = (entry.date + '').toString().trim().slice(0, 10);
      if (entry.times_available) {
        try {
          entry.times_available = JSON.parse(entry.times_available as string);
        } catch (err) {
          log(`Parse times_available JSON failed: ${formatErrorForLog(err)}`);
          entry.times_available = [];
        }
      }
      if (entry.available === 'TRUE' || entry.available === true) {
        entry.available = true;
      } else {
        entry.available = false;
      }
      if (entry.date) {
        cache.push(entry as unknown as CacheEntryFromSheet);
        cacheDateToRowIndex.set(entry.date as string, i + 1);
      }
    }

    log(`Read ${cache.length} cache entries from Google Sheets`);
    return cache;
  }).catch((error) => {
    log(`Failed to read cache from Google Sheets: ${formatErrorForLog(error)}`);
    return [];
  });
}

export async function updateAvailableDate(
  date: string,
  available: boolean,
  times: string[] = [],
  facilityId = 134
): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  return withQuotaRetry(async () => {
    const dateOnly = date.toString().slice(0, 10);
    let rowIndex = cacheDateToRowIndex.get(dateOnly);

    if (rowIndex == null) {
      const response = await sheets!.spreadsheets.values.get({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_CACHE}!A:A`,
      });
      const rows = (response.data.values ?? []) as (string | number)[][];
      for (let i = 1; i < rows.length; i++) {
        const cell = (rows[i][0] ?? '').toString();
        if (cell.slice(0, 10) === dateOnly || cell === date) {
          rowIndex = i + 1;
          cacheDateToRowIndex.set(dateOnly, rowIndex);
          break;
        }
      }
    }

    const now = new Date();
    const cacheValidUntil = new Date(now.getTime() + 60 * 1000);
    const dateWithTime = formatDateTimeForSheet(date, times[0]);
    const values = [
      dateWithTime,
      facilityId,
      available ? 'TRUE' : 'FALSE',
      now.toISOString(),
      JSON.stringify(times),
      cacheValidUntil.toISOString(),
    ];

    if (rowIndex != null && rowIndex > 0) {
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_CACHE}!A${rowIndex}:F${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [values] },
      });
    } else {
      const appendRes = await sheets!.spreadsheets.values.append({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_CACHE}!A:F`,
        valueInputOption: 'RAW',
        requestBody: { values: [values] },
      });
      const updatedRange = appendRes?.data?.updates?.updatedRange;
      if (updatedRange) {
        const match = updatedRange.match(/A(\d+):/);
        if (match) cacheDateToRowIndex.set(dateOnly, parseInt(match[1], 10));
      }
    }

    log(`Updated cache for date ${date}: available=${available}`);
  }).catch((error) => {
    log(`Failed to update cache for date ${date}: ${formatErrorForLog(error)}`);
  });
}

export interface BookingAttemptLog {
  user_email?: string;
  date_attempted?: string | null;
  time_attempted?: string | null;
  result?: string;
  reason?: string;
  old_date?: string | null;
  old_time?: string | null;
  new_date?: string | null;
  new_time?: string | null;
}

export async function logBookingAttempt(attempt: BookingAttemptLog): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  return withQuotaRetry(async () => {
    const values = [
      new Date().toISOString(),
      attempt.user_email ?? '',
      formatDateTimeForSheet(attempt.date_attempted, attempt.time_attempted),
      attempt.result ?? 'unknown',
      attempt.reason ?? '',
      formatDateTimeForSheet(attempt.old_date, attempt.old_time),
      formatDateTimeForSheet(attempt.new_date, attempt.new_time),
    ];

    await sheets!.spreadsheets.values.append({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_LOGS}!A:G`,
      valueInputOption: 'RAW',
      requestBody: { values: [values] },
    });

    log(`Logged booking attempt: ${attempt.user_email} - ${attempt.result}`);
  }).catch((error) => {
    log(`Failed to log booking attempt: ${formatErrorForLog(error)}`);
  });
}

async function getColumnIndex(headerName: string): Promise<number> {
  if (!sheets || !spreadsheetId) return -1;
  try {
    let headers = usersHeaderCache;
    if (!headers || headers.length === 0) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_USERS}!1:1`,
      });
      headers = (response.data.values?.[0] ?? []).map(String);
      usersHeaderCache = headers;
    }
    const normalizedHeader = headerName.toLowerCase().replace(/\s+/g, '_');
    for (let i = 0; i < headers.length; i++) {
      const normalized = String(headers[i] ?? '').toLowerCase().replace(/\s+/g, '_');
      if (normalized === normalizedHeader) return i;
    }
    return -1;
  } catch (error) {
    log(`Failed to get column index for ${headerName}: ${formatErrorForLog(error)}`);
    return -1;
  }
}

export async function updateUserLastChecked(
  email: string,
  timestamp: Date,
  rowIndex?: number | null
): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const lastCheckedCol = await getColumnIndex('last_checked');
      if (lastCheckedCol < 0) return;
      const colLetter = columnIndexToLetter(lastCheckedCol);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[timestamp.toISOString()]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const lastCheckedCol = await getColumnIndex('last_checked');
    if (emailCol < 0 || lastCheckedCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = (response.data.values ?? []) as string[][];
    let found = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        found = i + 1;
        emailToRowIndex.set(email, found);
        break;
      }
    }
    if (found > 0) {
      const colLetter = columnIndexToLetter(lastCheckedCol);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[timestamp.toISOString()]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update last_checked for ${email}: ${formatErrorForLog(error)}`);
  });
}

export async function updateUserCurrentDate(
  email: string,
  newDate: string,
  timeSlot: string | null = null,
  rowIndex?: number | null
): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const currentDateCol = await getColumnIndex('current_date');
      if (currentDateCol < 0) return;
      const colLetter = columnIndexToLetter(currentDateCol);
      const value = formatDateTimeForSheet(newDate, timeSlot);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const currentDateCol = await getColumnIndex('current_date');
    if (emailCol < 0 || currentDateCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = (response.data.values ?? []) as string[][];
    let found = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        found = i + 1;
        emailToRowIndex.set(email, found);
        break;
      }
    }
    if (found > 0) {
      const colLetter = columnIndexToLetter(currentDateCol);
      const value = formatDateTimeForSheet(newDate, timeSlot);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update current_date for ${email}: ${formatErrorForLog(error)}`);
  });
}

export async function updateUserLastBooked(
  email: string,
  date: string,
  timeSlot: string | null = null,
  rowIndex?: number | null
): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const lastBookedCol = await getColumnIndex('last_booked');
      if (lastBookedCol < 0) return;
      const colLetter = columnIndexToLetter(lastBookedCol);
      const value = formatDateTimeForSheet(date, timeSlot);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const lastBookedCol = await getColumnIndex('last_booked');
    if (emailCol < 0 || lastBookedCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = (response.data.values ?? []) as string[][];
    let found = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        found = i + 1;
        emailToRowIndex.set(email, found);
        break;
      }
    }
    if (found > 0) {
      const colLetter = columnIndexToLetter(lastBookedCol);
      const value = formatDateTimeForSheet(date, timeSlot);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[value]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update last_booked for ${email}: ${formatErrorForLog(error)}`);
  });
}

export async function updateUserPriority(
  email: string,
  priority: number,
  rowIndex?: number | null
): Promise<void> {
  if (!sheets || !spreadsheetId) return;
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const priorityCol = await getColumnIndex('priority');
      if (priorityCol < 0) return;
      const colLetter = columnIndexToLetter(priorityCol);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[priority]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const priorityCol = await getColumnIndex('priority');
    if (emailCol < 0 || priorityCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets!.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = (response.data.values ?? []) as string[][];
    let found = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        found = i + 1;
        emailToRowIndex.set(email, found);
        break;
      }
    }
    if (found > 0) {
      const colLetter = columnIndexToLetter(priorityCol);
      await sheets!.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[priority]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update priority for ${email}: ${formatErrorForLog(error)}`);
  });
}
