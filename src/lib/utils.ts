export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}

export function isSocketHangupError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const obj = err as { code?: string; message?: unknown };
  const code = obj.code;
  const msg = obj.message != null ? String(obj.message) : '';
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
 */
export function formatErrorForLog(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string; cause?: { name?: string; code?: string; message?: string; reason?: string } } | null | undefined;
  const cause = e?.cause;
  const isAbort = e?.name === 'AbortError' || cause?.name === 'AbortError';
  if (isAbort) return 'Request timeout (no response from server)';
  const msg = e?.message ?? String(err);
  const code = e?.code;
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
