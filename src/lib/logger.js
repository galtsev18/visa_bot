/**
 * Structured logger with levels (Phase 5).
 * LOG_LEVEL env: 'trace' | 'debug' | 'info' | 'warn' | 'error' (default: 'info').
 * In production, output is JSON; pipe to pino-pretty for readable dev logs.
 */
import pino from 'pino';

const level = (process.env.LOG_LEVEL || 'info').toLowerCase();

export const logger = pino({
  level,
  base: undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export default logger;
