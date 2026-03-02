import * as chrono from 'chrono-node';
import { log } from './utils';

export interface ParsedDateRange {
  from: Date;
  to: Date;
}

/**
 * Parse a date string to a Date object.
 * Supports both digital format (YYYY-MM-DD) and human-readable format (e.g., "June 1, 2024").
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    const date = new Date(dateStr + 'T00:00:00');
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  try {
    const results = chrono.parse(dateStr);
    if (results && results.length > 0) {
      return results[0].start.date();
    }
    return null;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`parseDate failed for "${dateStr}": ${errMsg}`);
    return null;
  }
}

/**
 * Parse a date range object with "from" and "to" fields.
 */
export function parseDateRange(range: { from?: string; to?: string } | null | undefined): ParsedDateRange | null {
  if (!range || !range.from || !range.to) {
    return null;
  }

  const from = parseDate(range.from);
  const to = parseDate(range.to);

  if (!from || !to) {
    return null;
  }

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

/**
 * Parse an array of date ranges.
 */
export function parseDateRanges(ranges: unknown): ParsedDateRange[] {
  if (!Array.isArray(ranges)) {
    return [];
  }

  return ranges
    .map((range) => parseDateRange(range as { from?: string; to?: string }))
    .filter((range): range is ParsedDateRange => range !== null);
}

/**
 * Check if a date falls within any of the given date ranges.
 */
export function isDateInRanges(date: Date | string | null | undefined, ranges: ParsedDateRange[]): boolean {
  if (!date || !ranges || ranges.length === 0) {
    return false;
  }

  const dateObj: Date = date instanceof Date ? date : new Date(date + 'T00:00:00');

  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    return false;
  }

  const checkDate = new Date(dateObj);
  checkDate.setHours(0, 0, 0, 0);

  return ranges.some((range) => checkDate >= range.from && checkDate <= range.to);
}

/**
 * Format a date to YYYY-MM-DD string.
 */
export function formatDate(date: Date | string | null | undefined): string | null {
  if (typeof date === 'string') {
    return date.split('T')[0] ?? null;
  }

  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}
