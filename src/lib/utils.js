export function sleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export function log(message) {
  console.log(`[${new Date().toISOString()}]`, message);
}

export function isSocketHangupError(err) {
  if (err == null || typeof err !== 'object') return false;
  const code = err.code;
  const msg = err.message != null ? String(err.message) : '';
  return (
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('connection')
  );
}

/**
 * Format an error for logging so we see the real reason (e.g. network code, cause).
 * Node-fetch often leaves "reason: " empty; cause.code / cause.message have the details.
 * @param {Error} err
 * @returns {string}
 */
export function formatErrorForLog(err) {
  const cause = err?.cause;
  const isAbort = err?.name === 'AbortError' || cause?.name === 'AbortError';
  if (isAbort) return 'Request timeout (no response from server)';
  const msg = err?.message ?? String(err);
  const code = err?.code;
  const causeCode = cause?.code;
  const causeMsg = cause?.message ?? cause?.reason;
  const parts = [msg];
  if (code && !msg.includes(code)) parts.push(`[${code}]`);
  if (causeCode || causeMsg) {
    const detail = [causeCode, causeMsg].filter(Boolean).join(' ');
    if (detail && !msg.includes(detail)) parts.push(`(${detail})`);
  }
  return parts.join(' ');
}
