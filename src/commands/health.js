import { getMetrics } from '../lib/metrics.js';

/**
 * Health check command (Phase 5.15).
 * Exits 0 so process managers / containers can use it for liveness.
 * When the monitor has run, includes metrics (checksTotal, bookingsTotal, startedAt).
 */
export function healthCommand() {
  const payload = { status: 'ok', ts: new Date().toISOString() };
  const metrics = getMetrics();
  if (metrics.checksTotal > 0 || metrics.bookingsTotal > 0) {
    payload.metrics = {
      startedAt: metrics.startedAt,
      checksTotal: metrics.checksTotal,
      bookingsTotal: metrics.bookingsTotal,
      lastCheckAt: metrics.lastCheckAt,
      lastBookingAt: metrics.lastBookingAt,
    };
  }
  console.log(JSON.stringify(payload));
  process.exit(0);
}
