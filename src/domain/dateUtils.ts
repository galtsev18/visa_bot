/**
 * Domain date utilities (pure, no I/O).
 * Used by User for date validation and formatting.
 */

export interface ParsedDateRange {
  from: Date;
  to: Date;
}

/**
 * Check if a date falls within any of the given date ranges.
 */
export function isDateInRanges(
  date: Date | string | null | undefined,
  ranges: ParsedDateRange[]
): boolean {
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
