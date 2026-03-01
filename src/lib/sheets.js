import { google } from 'googleapis';
import { log, sleep } from './utils.js';
import { User } from './user.js';

let sheets = null;
let spreadsheetId = null;

// Sheet names
const SHEET_USERS = 'Users';
const SHEET_CACHE = 'Available Dates Cache';
const SHEET_LOGS = 'Booking Attempts Log';
const SHEET_SETTINGS = 'Settings';

// Caches to reduce Read requests (quota) — kept in memory for the run
/** @type {string[]|null} - First row of Users sheet for getColumnIndex */
let usersHeaderCache = null;
/** @type {Map<string, number>} - email -> 1-based row index (set by readUsers / getInitialData) */
const emailToRowIndex = new Map();
/** @type {Map<string, number>} - date (YYYY-MM-DD) -> 1-based row in Cache sheet (set by readAvailableDatesCache / getInitialData / updateAvailableDate) */
const cacheDateToRowIndex = new Map();

// Google Sheets API quota (429) handling: retry with backoff and one-time Telegram notify
const QUOTA_RETRY_WAIT_SEC = 65;
let quotaExceededNotified = false;
/** @type {((event: 'exceeded'|'resolved') => void)|null} */
let quotaNotifier = null;

export function setSheetsQuotaNotifier(/** @type {(event: 'exceeded'|'resolved') => void} */ fn) {
  quotaNotifier = fn;
}

function isQuotaError(err) {
  const msg = err?.message ?? '';
  return (
    err?.response?.status === 429 || msg.includes('Quota exceeded') || msg.includes('quota metric')
  );
}

/**
 * Run an async fn; on 429, notify once, wait, retry once. Notify when resolved.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withQuotaRetry(fn) {
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

/**
 * Format a date (YYYY-MM-DD) with optional time for spreadsheet cells so they show date and time.
 * @param {string} dateStr - Date YYYY-MM-DD
 * @param {string|null|undefined} timeStr - Optional time e.g. "09:00" or "14:30"
 * @returns {string} - "YYYY-MM-DD HH:mm" (time 00:00 if not provided)
 */
function formatDateTimeForSheet(dateStr, timeStr) {
  const d = (dateStr || '').toString().trim().slice(0, 10);
  if (!d) return '';
  const t = timeStr && timeStr.toString().trim() ? timeStr.toString().trim().slice(0, 5) : '00:00';
  return `${d} ${t}`;
}

/**
 * Convert column index (0-based) to column letter (A, B, ..., Z, AA, AB, ...)
 * @param {number} index - Column index (0-based)
 * @returns {string} - Column letter
 */
function columnIndexToLetter(index) {
  let result = '';
  index++;
  while (index > 0) {
    index--;
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

/**
 * Ensure required sheets exist (single get + single batchUpdate to minimize quota)
 */
async function ensureSheetsExist() {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = (spreadsheet.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);
  const required = [SHEET_USERS, SHEET_CACHE, SHEET_LOGS, SHEET_SETTINGS];
  const missing = required.filter((name) => !existingTitles.includes(name));
  if (missing.length === 0) return;
  log(`Creating ${missing.length} sheet(s): ${missing.join(', ')}...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: {
      requests: missing.map((sheetName) => ({
        addSheet: { properties: { title: sheetName } },
      })),
    },
  });
  missing.forEach((name) => log(`✅ Created sheet "${name}"`));
}

/**
 * Initialize Google Sheets client
 * @param {string} credentialsPath - Path to service account JSON file
 * @param {string} sheetId - Google Sheets ID
 */
export async function initializeSheets(credentialsPath, sheetId) {
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
    log(`Failed to initialize Google Sheets: ${error.message}`);
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

/**
 * Ensure all sheets have proper headers (1 batchGet + 1 batchUpdate to minimize quota)
 */
async function ensureHeaders() {
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

    const valueRanges = batch.data.valueRanges || [];
    const usersRow = valueRanges[0]?.values?.[0];
    const cacheRow = valueRanges[1]?.values?.[0];
    const logsRow = valueRanges[2]?.values?.[0];
    const settingsRow = valueRanges[3]?.values?.[0];

    if (usersRow && usersRow.length > 0) usersHeaderCache = usersRow;

    const updates = [];
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
      String(settingsRow[0] || '')
        .toLowerCase()
        .trim() === 'key' &&
      String(settingsRow[1] || '')
        .toLowerCase()
        .trim() === 'value';
    if (!settingsValid) {
      updates.push({ range: `${SHEET_SETTINGS}!1:1`, values: [SETTINGS_HEADERS] });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: updates,
        },
      });
      updates.forEach((u) => log(`Created headers for ${u.range.split('!')[0]}`));
    }

    log('All sheet headers verified/created');
  } catch (error) {
    if (
      error.message &&
      (error.message.includes('Unable to parse range') || error.response?.status === 400)
    ) {
      log('⚠️  Warning: One or more sheets may not exist.');
      log(
        'Required sheets: 1. "Users"  2. "Available Dates Cache"  3. "Booking Attempts Log"  4. "Settings"'
      );
    } else {
      log(`⚠️  Warning: Failed to ensure headers: ${error.message}`);
    }
  }
}

/** Sheet key (Settings!A) -> { configKey, number } for merging into config.
 * GOOGLE_SHEETS_ID and GOOGLE_CREDENTIALS_PATH are intentionally excluded — .env only. */
const SETTINGS_KEY_MAP = {
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

/** Default values to write when creating missing Settings rows (user can edit). */
const SETTINGS_DEFAULT_VALUES = {
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

/**
 * Read Settings sheet and return config overrides (structure checked every time).
 * Sheet: row 1 = key, value; row 2+ = setting name, value. Overrides .env for known keys.
 * @returns {Promise<Partial<Object>>} - Object with config keys to merge (e.g. { aisRequestDelaySec: 2 })
 */
export async function readSettingsFromSheet() {
  return withQuotaRetry(async () => {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_SETTINGS}!A1:B500`,
    });
    const rows = response.data.values || [];
    if (rows.length < 1) return {};

    const headerKey = String(rows[0][0] || '')
      .toLowerCase()
      .trim();
    const headerVal = String(rows[0][1] || '')
      .toLowerCase()
      .trim();
    if (headerKey !== 'key' || headerVal !== 'value') {
      log('Settings sheet: invalid structure (expected key, value). Fixing headers.');
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_SETTINGS}!1:1`,
        valueInputOption: 'RAW',
        resource: { values: [SETTINGS_HEADERS] },
      });
      return {};
    }

    const overrides = {};

    // Ensure all known setting keys exist (create rows with defaults if missing)
    const existingKeys = new Set();
    for (let i = 1; i < rows.length; i++) {
      const k = String((rows[i] || [])[0] || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');
      if (k) existingKeys.add(k);
    }
    const allKeys = Object.keys(SETTINGS_KEY_MAP);
    const missingKeys = allKeys.filter((k) => !existingKeys.has(k));
    if (missingKeys.length > 0) {
      const appendRows = missingKeys.map((k) => [k, SETTINGS_DEFAULT_VALUES[k] ?? '']);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_SETTINGS}!A:B`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: appendRows },
      });
      log(`Settings: added missing keys: ${missingKeys.join(', ')}`);
      // Apply default values for new keys in this read
      for (const k of missingKeys) {
        const mapping = SETTINGS_KEY_MAP[k];
        const raw = SETTINGS_DEFAULT_VALUES[k] ?? '';
        const value = mapping.number ? Number(raw) : raw != null ? String(raw).trim() : '';
        if (!mapping.number || (!Number.isNaN(value) && value !== undefined)) {
          overrides[mapping.configKey] = value;
        }
      }
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 1) continue;
      const key = String(row[0] || '')
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
      if (mapping.number && (value === undefined || Number.isNaN(value))) continue;
      overrides[mapping.configKey] = value;
    }
    if (Object.keys(overrides).length > 0) {
      log(`Settings from sheet: ${Object.keys(overrides).join(', ')}`);
    }
    return overrides;
  }).catch((error) => {
    log(`Failed to read Settings sheet: ${error.message}`);
    return {};
  });
}

/**
 * Read all users from the Users sheet
 * @returns {Promise<Array<User>>}
 */
export async function readUsers() {
  return withQuotaRetry(async () => {
    emailToRowIndex.clear();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!A1:Z1000`,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return [];
    }

    // First row is headers
    const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    const users = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const userData = {};
      headers.forEach((header, index) => {
        userData[header] = row[index] || '';
      });

      // Only include active users
      if (userData.active === true || userData.active === 'true' || userData.active === 'TRUE') {
        try {
          const oneBasedRow = i + 1;
          userData.rowIndex = oneBasedRow;
          const user = new User(userData);
          users.push(user);
          emailToRowIndex.set(user.email, oneBasedRow);
        } catch (error) {
          log(`Failed to parse user ${userData.email}: ${error.message}`);
        }
      }
    }

    log(`Read ${users.length} active users from Google Sheets`);
    return users;
  }).catch((error) => {
    log(`Failed to read users from Google Sheets: ${error.message}`);
    throw error;
  });
}

/**
 * Single batch read of Users + Cache to minimize quota (1 read instead of 2 at startup).
 * Populates emailToRowIndex, cacheDateToRowIndex, and usersHeaderCache.
 * @returns {Promise<{ users: import('./user.js').User[], cacheEntries: Array }>}
 */
export async function getInitialData() {
  return withQuotaRetry(async () => {
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [`${SHEET_USERS}!A1:Z1000`, `${SHEET_CACHE}!A1:F1000`],
    });
    const valueRanges = batch.data.valueRanges || [];
    const usersRows = valueRanges[0]?.values || [];
    const cacheRows = valueRanges[1]?.values || [];

    emailToRowIndex.clear();
    cacheDateToRowIndex.clear();

    const users = [];
    if (usersRows.length >= 2) {
      const headers = usersRows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
      usersHeaderCache = usersRows[0];
      for (let i = 1; i < usersRows.length; i++) {
        const row = usersRows[i];
        if (!row || row.length === 0) continue;
        const userData = {};
        headers.forEach((header, index) => {
          userData[header] = row[index] || '';
        });
        if (userData.active !== true && userData.active !== 'true' && userData.active !== 'TRUE')
          continue;
        try {
          const oneBasedRow = i + 1;
          userData.rowIndex = oneBasedRow;
          const user = new User(userData);
          users.push(user);
          emailToRowIndex.set(user.email, oneBasedRow);
        } catch (err) {
          log(`Failed to parse user ${userData.email}: ${err.message}`);
        }
      }
    }

    const cacheEntries = [];
    if (cacheRows.length >= 2) {
      const headers = cacheRows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
      for (let i = 1; i < cacheRows.length; i++) {
        const row = cacheRows[i];
        if (!row || row.length === 0) continue;
        const entry = {};
        headers.forEach((header, index) => {
          entry[header] = row[index] || '';
        });
        if (entry.date) entry.date = (entry.date + '').toString().trim().slice(0, 10);
        if (entry.times_available) {
          try {
            entry.times_available = JSON.parse(entry.times_available);
          } catch (err) {
            log(`Parse times_available JSON failed: ${err.message}`);
            entry.times_available = [];
          }
        }
        entry.available = entry.available === 'TRUE' || entry.available === true;
        cacheEntries.push(entry);
        if (entry.date) cacheDateToRowIndex.set(entry.date, i + 1); // 1-based sheet row
      }
    }

    log(`Initial data: ${users.length} users, ${cacheEntries.length} cache entries (1 batch read)`);
    return { users, cacheEntries };
  }).catch((error) => {
    log(`Failed to get initial data: ${error.message}`);
    throw error;
  });
}

/**
 * Read available dates cache from the cache sheet
 * @returns {Promise<Array>}
 */
export async function readAvailableDatesCache() {
  return withQuotaRetry(async () => {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_CACHE}!A1:F1000`,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return [];
    }

    const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    const cache = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] || '';
      });
      // Normalize date to YYYY-MM-DD for cache key (cell may be "YYYY-MM-DD HH:mm")
      if (entry.date) entry.date = (entry.date + '').toString().trim().slice(0, 10);

      // Parse JSON fields
      if (entry.times_available) {
        try {
          entry.times_available = JSON.parse(entry.times_available);
        } catch (err) {
          log(`Parse times_available JSON failed: ${err.message}`);
          entry.times_available = [];
        }
      }

      if (entry.available === 'TRUE' || entry.available === true) {
        entry.available = true;
      } else {
        entry.available = false;
      }

      cache.push(entry);
      if (entry.date) cacheDateToRowIndex.set(entry.date, i + 1); // 1-based sheet row
    }

    log(`Read ${cache.length} cache entries from Google Sheets`);
    return cache;
  }).catch((error) => {
    log(`Failed to read cache from Google Sheets: ${error.message}`);
    return [];
  });
}

/**
 * Update or insert an available date in the cache.
 * Uses in-memory cacheDateToRowIndex to avoid reading the sheet when the row is already known.
 */
export async function updateAvailableDate(date, available, times = [], facilityId = 134) {
  return withQuotaRetry(async () => {
    const dateOnly = date.toString().slice(0, 10);
    let rowIndex = cacheDateToRowIndex.get(dateOnly);

    if (rowIndex == null) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_CACHE}!A:A`,
      });
      const rows = response.data.values || [];
      for (let i = 1; i < rows.length; i++) {
        const cell = (rows[i][0] || '').toString();
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
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_CACHE}!A${rowIndex}:F${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [values] },
      });
    } else {
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_CACHE}!A:F`,
        valueInputOption: 'RAW',
        resource: { values: [values] },
      });
      const updatedRange = appendRes?.data?.updates?.updatedRange;
      if (updatedRange) {
        const match = updatedRange.match(/A(\d+):/);
        if (match) cacheDateToRowIndex.set(dateOnly, parseInt(match[1], 10));
      }
    }

    log(`Updated cache for date ${date}: available=${available}`);
  }).catch((error) => {
    log(`Failed to update cache for date ${date}: ${error.message}`);
  });
}

/**
 * Log a booking attempt
 * @param {Object} attempt - Booking attempt data
 */
export async function logBookingAttempt(attempt) {
  return withQuotaRetry(async () => {
    const values = [
      new Date().toISOString(),
      attempt.user_email || '',
      formatDateTimeForSheet(attempt.date_attempted, attempt.time_attempted),
      attempt.result || 'unknown',
      attempt.reason || '',
      formatDateTimeForSheet(attempt.old_date, attempt.old_time),
      formatDateTimeForSheet(attempt.new_date, attempt.new_time),
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_LOGS}!A:G`,
      valueInputOption: 'RAW',
      resource: { values: [values] },
    });

    log(`Logged booking attempt: ${attempt.user_email} - ${attempt.result}`);
  }).catch((error) => {
    log(`Failed to log booking attempt: ${error.message}`);
  });
}

/**
 * Get column index for a header (uses cache from ensureHeaders/readUsers to avoid extra reads)
 * @param {string} headerName - Header name to find
 * @returns {Promise<number>} - Column index (0-based) or -1 if not found
 */
async function getColumnIndex(headerName) {
  try {
    let headers = usersHeaderCache;
    if (!headers || headers.length === 0) {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_USERS}!1:1`,
      });
      headers = response.data.values?.[0] || [];
      usersHeaderCache = headers;
    }
    const normalizedHeader = headerName.toLowerCase().replace(/\s+/g, '_');
    for (let i = 0; i < headers.length; i++) {
      const normalized = String(headers[i] || '')
        .toLowerCase()
        .replace(/\s+/g, '_');
      if (normalized === normalizedHeader) return i;
    }
    return -1;
  } catch (error) {
    log(`Failed to get column index for ${headerName}: ${error.message}`);
    return -1;
  }
}

/**
 * Update user's last checked timestamp
 * @param {string} email - User email
 * @param {Date} timestamp - Timestamp
 * @param {number} [rowIndex] - 1-based row (skips read when provided or from cache)
 */
export async function updateUserLastChecked(email, timestamp, rowIndex) {
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const lastCheckedCol = await getColumnIndex('last_checked');
      if (lastCheckedCol < 0) return;
      const colLetter = columnIndexToLetter(lastCheckedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        resource: { values: [[timestamp.toISOString()]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const lastCheckedCol = await getColumnIndex('last_checked');
    if (emailCol < 0 || lastCheckedCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = response.data.values || [];
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
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        resource: { values: [[timestamp.toISOString()]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update last_checked for ${email}: ${error.message}`);
  });
}

/**
 * Update user's current date (stored with time in sheet)
 * @param {string} email - User email
 * @param {string} newDate - New date (YYYY-MM-DD)
 * @param {string|null|undefined} [timeSlot] - Optional time e.g. "09:00"
 * @param {number} [rowIndex] - 1-based row (skips read when provided or from cache)
 */
export async function updateUserCurrentDate(email, newDate, timeSlot = null, rowIndex) {
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const currentDateCol = await getColumnIndex('current_date');
      if (currentDateCol < 0) return;
      const colLetter = columnIndexToLetter(currentDateCol);
      const value = formatDateTimeForSheet(newDate, timeSlot);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        resource: { values: [[value]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const currentDateCol = await getColumnIndex('current_date');
    if (emailCol < 0 || currentDateCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = response.data.values || [];
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
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        resource: { values: [[value]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update current_date for ${email}: ${error.message}`);
  });
}

/**
 * Update user's last booked date (stored with time in sheet)
 * @param {string} email - User email
 * @param {string} date - Booked date (YYYY-MM-DD)
 * @param {string|null|undefined} [timeSlot] - Optional time e.g. "09:00"
 * @param {number} [rowIndex] - 1-based row (skips read when provided or from cache)
 */
export async function updateUserLastBooked(email, date, timeSlot = null, rowIndex) {
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const lastBookedCol = await getColumnIndex('last_booked');
      if (lastBookedCol < 0) return;
      const colLetter = columnIndexToLetter(lastBookedCol);
      const value = formatDateTimeForSheet(date, timeSlot);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        resource: { values: [[value]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const lastBookedCol = await getColumnIndex('last_booked');
    if (emailCol < 0 || lastBookedCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = response.data.values || [];
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
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        resource: { values: [[value]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update last_booked for ${email}: ${error.message}`);
  });
}

/**
 * Update user's priority
 * @param {string} email - User email
 * @param {number} priority - Priority value
 * @param {number} [rowIndex] - 1-based row (skips read when provided or from cache)
 */
export async function updateUserPriority(email, priority, rowIndex) {
  return withQuotaRetry(async () => {
    const r = rowIndex ?? emailToRowIndex.get(email);
    if (r != null && r > 0) {
      const priorityCol = await getColumnIndex('priority');
      if (priorityCol < 0) return;
      const colLetter = columnIndexToLetter(priorityCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${r}`,
        valueInputOption: 'RAW',
        resource: { values: [[priority]] },
      });
      return;
    }
    const emailCol = await getColumnIndex('email');
    const priorityCol = await getColumnIndex('priority');
    if (emailCol < 0 || priorityCol < 0) return;
    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });
    const rows = response.data.values || [];
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
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${found}`,
        valueInputOption: 'RAW',
        resource: { values: [[priority]] },
      });
    }
  }).catch((error) => {
    log(`Failed to update priority for ${email}: ${error.message}`);
  });
}
