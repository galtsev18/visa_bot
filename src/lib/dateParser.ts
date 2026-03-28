import * as chrono from 'chrono-node';
import type { ParsedDateRange } from '../domain/dateUtils';
import { logger } from './logger';
import { formatErrorForLog } from './utils';

export type { ParsedDateRange } from '../domain/dateUtils';

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
    const errMsg = formatErrorForLog(err);
    logger.warn(`parseDate failed for "${dateStr}": ${errMsg}`);
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
 * Default JSON for sheet `date_ranges` when the cell is empty or invalid:
 * from the first day of the current month through end of calendar year +2 (wide window for slot search).
 */
export function defaultDateRangesJson(): string {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear() + 2, 11, 31);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return JSON.stringify([{ from: fmt(from), to: fmt(to) }]);
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

/** Re-export for callers that still use lib/dateParser. Prefer domain/dateUtils. */
export { isDateInRanges, formatDate } from '../domain/dateUtils';
