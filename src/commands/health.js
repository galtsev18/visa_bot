/**
 * Health check command (Phase 5.15).
 * Exits 0 so process managers / containers can use it for liveness.
 */
export function healthCommand() {
  const payload = { status: 'ok', ts: new Date().toISOString() };
  console.log(JSON.stringify(payload));
  process.exit(0);
}
