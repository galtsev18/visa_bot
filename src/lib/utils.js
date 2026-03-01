export function sleep(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export function log(message) {
  console.log(`[${new Date().toISOString()}]`, message);
}

export function isSocketHangupError(err) {
  return (
    err.code === 'ECONNRESET' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'ETIMEDOUT' ||
    err.message.includes('socket hang up') ||
    err.message.includes('network') ||
    err.message.includes('connection')
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
