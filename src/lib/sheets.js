import { google } from 'googleapis';
import { log } from './utils.js';
import { User } from './user.js';

let sheets = null;
let spreadsheetId = null;

// Sheet names
const SHEET_USERS = 'Users';
const SHEET_CACHE = 'Available Dates Cache';
const SHEET_LOGS = 'Booking Attempts Log';

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
 * Create a sheet if it doesn't exist
 * @param {string} sheetName - Name of the sheet to create
 */
async function createSheetIfNotExists(sheetName) {
  try {
    // Get all sheets in the spreadsheet
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const existingSheets = spreadsheet.data.sheets || [];
    const sheetExists = existingSheets.some(sheet => sheet.properties.title === sheetName);

    if (!sheetExists) {
      log(`Creating sheet "${sheetName}"...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });
      log(`✅ Created sheet "${sheetName}"`);
      return true;
    }
    return false;
  } catch (error) {
    log(`Failed to create sheet "${sheetName}": ${error.message}`);
    throw error;
  }
}

/**
 * Initialize Google Sheets client
 * @param {string} credentialsPath - Path to service account JSON file
 * @param {string} sheetId - Google Sheets ID
 */
export async function initializeSheets(credentialsPath, sheetId) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    spreadsheetId = sheetId;
    
    log('Google Sheets initialized');
    
    // Create sheets if they don't exist
    await createSheetIfNotExists(SHEET_USERS);
    await createSheetIfNotExists(SHEET_CACHE);
    await createSheetIfNotExists(SHEET_LOGS);
    
    // Ensure headers exist
    await ensureHeaders();
    
    return true;
  } catch (error) {
    log(`Failed to initialize Google Sheets: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure all sheets have proper headers
 */
async function ensureHeaders() {
  try {
    // Check if Users sheet has headers
    const usersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!1:1`,
    });

    if (!usersResponse.data.values || usersResponse.data.values.length === 0) {
      // Create headers for Users sheet
      const usersHeaders = [
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
        'priority'
      ];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!1:1`,
        valueInputOption: 'RAW',
        resource: { values: [usersHeaders] },
      });
      log('Created headers for Users sheet');
    }

    // Check if Cache sheet has headers
    const cacheResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_CACHE}!1:1`,
    });

    if (!cacheResponse.data.values || cacheResponse.data.values.length === 0) {
      // Create headers for Cache sheet
      const cacheHeaders = [
        'date',
        'facility_id',
        'available',
        'last_checked',
        'times_available',
        'cache_valid_until'
      ];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_CACHE}!1:1`,
        valueInputOption: 'RAW',
        resource: { values: [cacheHeaders] },
      });
      log('Created headers for Available Dates Cache sheet');
    }

    // Check if Logs sheet has headers
    const logsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_LOGS}!1:1`,
    });

    if (!logsResponse.data.values || logsResponse.data.values.length === 0) {
      // Create headers for Logs sheet
      const logsHeaders = [
        'timestamp',
        'user_email',
        'date_attempted',
        'result',
        'reason',
        'old_date',
        'new_date'
      ];
      
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_LOGS}!1:1`,
        valueInputOption: 'RAW',
        resource: { values: [logsHeaders] },
      });
      log('Created headers for Booking Attempts Log sheet');
    }

    log('All sheet headers verified/created');
  } catch (error) {
    // If sheets don't exist, provide helpful error message
    if (error.message && (error.message.includes('Unable to parse range') || error.response?.status === 400)) {
      log('⚠️  Warning: One or more sheets may not exist.');
      log('Required sheets:');
      log('  1. "Users"');
      log('  2. "Available Dates Cache"');
      log('  3. "Booking Attempts Log"');
      log('Please create these sheets in your spreadsheet with these exact names.');
      log('The bot will create headers automatically when the sheets exist.');
      // Don't throw - let the actual operations fail with better error messages
    } else {
      log(`⚠️  Warning: Failed to ensure headers: ${error.message}`);
      // Don't throw - headers might already exist
    }
  }
}

/**
 * Read all users from the Users sheet
 * @returns {Promise<Array<User>>}
 */
export async function readUsers() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!A1:Z1000`,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return [];
    }

    // First row is headers
    const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
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
          users.push(new User(userData));
        } catch (error) {
          log(`Failed to parse user ${userData.email}: ${error.message}`);
        }
      }
    }

    log(`Read ${users.length} active users from Google Sheets`);
    return users;
  } catch (error) {
    log(`Failed to read users from Google Sheets: ${error.message}`);
    throw error;
  }
}

/**
 * Read available dates cache from the cache sheet
 * @returns {Promise<Array>}
 */
export async function readAvailableDatesCache() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_CACHE}!A1:F1000`,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return [];
    }

    const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const cache = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = row[index] || '';
      });

      // Parse JSON fields
      if (entry.times_available) {
        try {
          entry.times_available = JSON.parse(entry.times_available);
        } catch (e) {
          entry.times_available = [];
        }
      }

      if (entry.available === 'TRUE' || entry.available === true) {
        entry.available = true;
      } else {
        entry.available = false;
      }

      cache.push(entry);
    }

    log(`Read ${cache.length} cache entries from Google Sheets`);
    return cache;
  } catch (error) {
    log(`Failed to read cache from Google Sheets: ${error.message}`);
    return [];
  }
}

/**
 * Update or insert an available date in the cache
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {boolean} available - Is date available
 * @param {Array} times - Available time slots
 * @param {number} facilityId - Facility ID
 */
export async function updateAvailableDate(date, available, times = [], facilityId = 134) {
  try {
    // First, try to find existing row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_CACHE}!A:A`,
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    // Find row with matching date
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === date) {
        rowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    const now = new Date();
    const cacheValidUntil = new Date(now.getTime() + (60 * 1000)); // 60 seconds from now

    const values = [
      date,
      facilityId,
      available ? 'TRUE' : 'FALSE',
      now.toISOString(),
      JSON.stringify(times),
      cacheValidUntil.toISOString()
    ];

    if (rowIndex > 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_CACHE}!A${rowIndex}:F${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [values] },
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_CACHE}!A:F`,
        valueInputOption: 'RAW',
        resource: { values: [values] },
      });
    }

    log(`Updated cache for date ${date}: available=${available}`);
  } catch (error) {
    log(`Failed to update cache for date ${date}: ${error.message}`);
  }
}

/**
 * Log a booking attempt
 * @param {Object} attempt - Booking attempt data
 */
export async function logBookingAttempt(attempt) {
  try {
    const values = [
      new Date().toISOString(),
      attempt.user_email || '',
      attempt.date_attempted || '',
      attempt.result || 'unknown',
      attempt.reason || '',
      attempt.old_date || '',
      attempt.new_date || ''
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_LOGS}!A:G`,
      valueInputOption: 'RAW',
      resource: { values: [values] },
    });

    log(`Logged booking attempt: ${attempt.user_email} - ${attempt.result}`);
  } catch (error) {
    log(`Failed to log booking attempt: ${error.message}`);
  }
}

/**
 * Get column index for a header
 * @param {string} headerName - Header name to find
 * @returns {Promise<number>} - Column index (0-based) or -1 if not found
 */
async function getColumnIndex(headerName) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!1:1`,
    });

    const headers = response.data.values?.[0] || [];
    const normalizedHeader = headerName.toLowerCase().replace(/\s+/g, '_');
    
    for (let i = 0; i < headers.length; i++) {
      const normalized = headers[i].toLowerCase().replace(/\s+/g, '_');
      if (normalized === normalizedHeader) {
        return i;
      }
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
 */
export async function updateUserLastChecked(email, timestamp) {
  try {
    const emailCol = await getColumnIndex('email');
    const lastCheckedCol = await getColumnIndex('last_checked');
    
    if (emailCol < 0 || lastCheckedCol < 0) {
      log('Could not find email or last_checked column');
      return;
    }

    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex > 0) {
      const colLetter = columnIndexToLetter(lastCheckedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [[timestamp.toISOString()]] },
      });
    }
  } catch (error) {
    log(`Failed to update last_checked for ${email}: ${error.message}`);
  }
}

/**
 * Update user's current date
 * @param {string} email - User email
 * @param {string} newDate - New date (YYYY-MM-DD)
 */
export async function updateUserCurrentDate(email, newDate) {
  try {
    const emailCol = await getColumnIndex('email');
    const currentDateCol = await getColumnIndex('current_date');
    
    if (emailCol < 0 || currentDateCol < 0) {
      log('Could not find email or current_date column');
      return;
    }

    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex > 0) {
      const colLetter = columnIndexToLetter(currentDateCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [[newDate]] },
      });
    }
  } catch (error) {
    log(`Failed to update current_date for ${email}: ${error.message}`);
  }
}

/**
 * Update user's last booked date
 * @param {string} email - User email
 * @param {string} date - Booked date (YYYY-MM-DD)
 */
export async function updateUserLastBooked(email, date) {
  try {
    const emailCol = await getColumnIndex('email');
    const lastBookedCol = await getColumnIndex('last_booked');
    
    if (emailCol < 0 || lastBookedCol < 0) {
      log('Could not find email or last_booked column');
      return;
    }

    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex > 0) {
      const colLetter = columnIndexToLetter(lastBookedCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [[date]] },
      });
    }
  } catch (error) {
    log(`Failed to update last_booked for ${email}: ${error.message}`);
  }
}

/**
 * Update user's priority
 * @param {string} email - User email
 * @param {number} priority - Priority value
 */
export async function updateUserPriority(email, priority) {
  try {
    const emailCol = await getColumnIndex('email');
    const priorityCol = await getColumnIndex('priority');
    
    if (emailCol < 0 || priorityCol < 0) {
      log('Could not find email or priority column');
      return;
    }

    const emailColLetter = columnIndexToLetter(emailCol);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_USERS}!${emailColLetter}:${emailColLetter}`,
    });

    const rows = response.data.values || [];
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === email) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex > 0) {
      const colLetter = columnIndexToLetter(priorityCol);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_USERS}!${colLetter}${rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [[priority]] },
      });
    }
  } catch (error) {
    log(`Failed to update priority for ${email}: ${error.message}`);
  }
}
