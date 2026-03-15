import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, writeSettingsTimingDefaults } from '../lib/sheets';
import { logger } from '../lib/logger';
import { formatErrorForLog } from '../lib/utils';

/**
 * One-off: write current timing defaults into the Settings sheet
 * (REFRESH_INTERVAL=5, SHEETS_REFRESH_INTERVAL=400, CACHE_TTL=90, ROTATION_COOLDOWN=45).
 */
export async function updateSettingsTimingsCommand(): Promise<void> {
  const config = getConfig();
  validateEnvForSheets(config);

  logger.info('Writing timing defaults to Settings sheet...');

  try {
    await initializeSheets(config.googleCredentialsPath!, config.googleSheetsId!);
    await writeSettingsTimingDefaults();
    logger.info('Done. Monitor will use the new values on next sheets refresh.');
  } catch (error) {
    logger.error(`Failed to update Settings: ${formatErrorForLog(error)}`);
    throw error;
  }
}
