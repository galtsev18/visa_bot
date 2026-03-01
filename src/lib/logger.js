/**
 * Re-export from TypeScript source. Required so that import './lib/logger.js' resolves
 * when running from src (tsx); dist has logger.js from compiling logger.ts.
 */
export { logger, default } from './logger.ts';
