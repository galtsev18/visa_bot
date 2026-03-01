import * as chrono from 'chrono-node';
import { log } from './utils.js';

/**
 * Parse a date string to a Date object
 * Supports both digital format (YYYY-MM-DD) and human-readable format (e.g., "June 1, 2024")
 * @param {string} dateStr - Date string (e.g., "2024-06-01" or "June 1, 2024")
 * @returns {Date|null} - Parsed date or null if parsing fails
 */
export function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  // First try direct parsing for YYYY-MM-DD format (most common)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    const date = new Date(dateStr + 'T00:00:00');
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fall back to chrono for other formats
  try {
    const results = chrono.parse(dateStr);
    if (results && results.length > 0) {
      return results[0].start.date();
    }
    return null;
  } catch (err) {
    log(`parseDate failed for "${dateStr}": ${err.message}`);
    return null;
  }
}

/**
 * Parse a date range object with "from" and "to" fields
 * @param {Object} range - Object with "from" and "to" date strings
 * @returns {Object|null} - Object with from/to Date objects or null if parsing fails
 */
export function parseDateRange(range) {
  if (!range || !range.from || !range.to) {
    return null;
  }

  const from = parseDate(range.from);
  const to = parseDate(range.to);

  if (!from || !to) {
    return null;
  }

  // Normalize to start of day for "from" and end of day for "to"
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

/**
 * Parse an array of date ranges
 * @param {Array} ranges - Array of date range objects
 * @returns {Array} - Array of parsed date ranges
 */
export function parseDateRanges(ranges) {
  if (!Array.isArray(ranges)) {
    return [];
  }

  return ranges.map((range) => parseDateRange(range)).filter((range) => range !== null);
}

/**
 * Check if a date falls within any of the given date ranges
 * @param {Date|string} date - Date to check (Date object or YYYY-MM-DD string)
 * @param {Array} ranges - Array of parsed date ranges
 * @returns {boolean} - True if date is in any range
 */
export function isDateInRanges(date, ranges) {
  if (!date || !ranges || ranges.length === 0) {
    return false;
  }

  // Convert string date to Date object if needed
  let dateObj = date;
  if (typeof date === 'string') {
    dateObj = new Date(date + 'T00:00:00');
  }

  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    return false;
  }

  // Normalize to start of day for comparison
  const checkDate = new Date(dateObj);
  checkDate.setHours(0, 0, 0, 0);

  return ranges.some((range) => {
    return checkDate >= range.from && checkDate <= range.to;
  });
}

/**
 * Format a date to YYYY-MM-DD string
 * @param {Date|string} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDate(date) {
  if (typeof date === 'string') {
    return date.split('T')[0];
  }

  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}
