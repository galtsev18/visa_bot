/**
 * Simple metrics for monitor (Phase 5.15).
 * Persisted to a JSON file so the health command can read them from another process.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_FILE = join(process.cwd(), '.us-visa-bot-metrics.json');

function getPath() {
  return process.env.METRICS_FILE || DEFAULT_FILE;
}

/**
 * @typedef {{
 *   startedAt: string;
 *   checksTotal: number;
 *   bookingsTotal: number;
 *   lastCheckAt?: string;
 *   lastBookingAt?: string;
 * }} MetricsSnapshot
 */

/**
 * @returns {MetricsSnapshot}
 */
function emptySnapshot() {
  return {
    startedAt: new Date().toISOString(),
    checksTotal: 0,
    bookingsTotal: 0,
  };
}

/**
 * @returns {MetricsSnapshot}
 */
function readSnapshot() {
  const path = getPath();
  if (!existsSync(path)) return emptySnapshot();
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    return {
      startedAt: data.startedAt ?? new Date().toISOString(),
      checksTotal: Number(data.checksTotal) || 0,
      bookingsTotal: Number(data.bookingsTotal) || 0,
      lastCheckAt: data.lastCheckAt,
      lastBookingAt: data.lastBookingAt,
    };
  } catch {
    return emptySnapshot();
  }
}

function writeSnapshot(snapshot) {
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
export function startMetrics() {
  const s = readSnapshot();
  s.startedAt = new Date().toISOString();
  writeSnapshot(s);
}

/**
 * Call once per user check in the monitoring loop.
 */
export function incrementChecks() {
  const s = readSnapshot();
  s.checksTotal = (s.checksTotal || 0) + 1;
  s.lastCheckAt = new Date().toISOString();
  writeSnapshot(s);
}

/**
 * Call when a booking succeeds.
 */
export function incrementBookings() {
  const s = readSnapshot();
  s.bookingsTotal = (s.bookingsTotal || 0) + 1;
  s.lastBookingAt = new Date().toISOString();
  writeSnapshot(s);
}

/**
 * Read current metrics (e.g. for health command).
 * @returns {MetricsSnapshot}
 */
export function getMetrics() {
  return readSnapshot();
}
