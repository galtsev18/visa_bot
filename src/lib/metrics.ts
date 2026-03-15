/**
 * Simple metrics for monitor (Phase 5.15).
 * Persisted to a JSON file so the health command can read them from another process.
 * Daily stats (slots missed, bookings, errors) accumulate and are sent in the 10:00 report, then reset.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_FILE = join(process.cwd(), '.us-visa-bot-metrics.json');

export interface MetricsSnapshot {
  startedAt: string;
  checksTotal: number;
  bookingsTotal: number;
  lastCheckAt?: string;
  lastBookingAt?: string;
  /** За сутки: слот нашли, но не успели записаться */
  dailySlotsMissed: number;
  /** За сутки: успешных записей */
  dailyBookings: number;
  /** За сутки: ошибки (ключ — нормализованное описание, значение — количество) */
  dailyErrorCounts: Record<string, number>;
  /** Дата/время последней отправки ежедневного отчёта (YYYY-MM-DD) */
  lastReportSentDate?: string;
}

function getPath(): string {
  return process.env.METRICS_FILE ?? DEFAULT_FILE;
}

function emptySnapshot(): MetricsSnapshot {
  return {
    startedAt: new Date().toISOString(),
    checksTotal: 0,
    bookingsTotal: 0,
    dailySlotsMissed: 0,
    dailyBookings: 0,
    dailyErrorCounts: {},
  };
}

function readSnapshot(): MetricsSnapshot {
  const path = getPath();
  if (!existsSync(path)) return emptySnapshot();
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw) as Partial<MetricsSnapshot>;
    return {
      startedAt: data.startedAt ?? new Date().toISOString(),
      checksTotal: Number(data.checksTotal) || 0,
      bookingsTotal: Number(data.bookingsTotal) || 0,
      lastCheckAt: data.lastCheckAt,
      lastBookingAt: data.lastBookingAt,
      dailySlotsMissed: Number(data.dailySlotsMissed) || 0,
      dailyBookings: Number(data.dailyBookings) || 0,
      dailyErrorCounts:
        data.dailyErrorCounts && typeof data.dailyErrorCounts === 'object'
          ? data.dailyErrorCounts
          : {},
      lastReportSentDate: data.lastReportSentDate,
    };
  } catch {
    return emptySnapshot();
  }
}

function writeSnapshot(snapshot: MetricsSnapshot): void {
  const path = getPath();
  try {
    writeFileSync(path, JSON.stringify(snapshot, null, 0), 'utf8');
  } catch {
    // ignore write errors (e.g. read-only fs)
  }
}

/**
 * Call when the monitor loop starts (resets or initializes metrics).
 */
export function startMetrics(): void {
  const s = readSnapshot();
  s.startedAt = new Date().toISOString();
  writeSnapshot(s);
}

/**
 * Call once per user check in the monitoring loop.
 */
export function incrementChecks(): void {
  const s = readSnapshot();
  s.checksTotal = (s.checksTotal || 0) + 1;
  s.lastCheckAt = new Date().toISOString();
  writeSnapshot(s);
}

/**
 * Call when a booking succeeds.
 */
export function incrementBookings(): void {
  const s = readSnapshot();
  s.bookingsTotal = (s.bookingsTotal || 0) + 1;
  s.dailyBookings = (s.dailyBookings || 0) + 1;
  s.lastBookingAt = new Date().toISOString();
  writeSnapshot(s);
}

/**
 * Call when a slot was found but we didn't manage to book (e.g. no time slot, error).
 */
export function incrementSlotsMissed(): void {
  const s = readSnapshot();
  s.dailySlotsMissed = (s.dailySlotsMissed || 0) + 1;
  writeSnapshot(s);
}

/** Нормализует текст ошибки для агрегации (короткий ключ). */
function normalizeErrorKey(msg: string): string {
  const t = msg.slice(0, 120).trim();
  return t || 'unknown';
}

/**
 * Call when an error occurred (e.g. booking failure, loop error). Aggregates by normalized message.
 */
export function recordError(errorMessageOrKey: string): void {
  const s = readSnapshot();
  const key = normalizeErrorKey(errorMessageOrKey);
  s.dailyErrorCounts = s.dailyErrorCounts || {};
  s.dailyErrorCounts[key] = (s.dailyErrorCounts[key] || 0) + 1;
  writeSnapshot(s);
}

/**
 * Read current metrics (e.g. for health command).
 */
export function getMetrics(): MetricsSnapshot {
  return readSnapshot();
}

/** Возвращает true, если сегодня (local) ещё не отправляли отчёт. */
export function shouldSendDailyReport(): boolean {
  const s = readSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  return s.lastReportSentDate !== today;
}

/** Отметить, что отчёт за сегодня отправлен; сбросить дневные счётчики. */
export function markDailyReportSent(): void {
  const s = readSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  s.lastReportSentDate = today;
  s.dailySlotsMissed = 0;
  s.dailyBookings = 0;
  s.dailyErrorCounts = {};
  writeSnapshot(s);
}
