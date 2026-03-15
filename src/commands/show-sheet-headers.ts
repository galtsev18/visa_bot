import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, getSheetHeaders } from '../lib/sheets';
import { logger } from '../lib/logger';
import { formatErrorForLog } from '../lib/utils';

/**
 * Print current header row of US_users and VFS users sheets (for debugging / aligning code).
 */
export async function showSheetHeadersCommand(): Promise<void> {
  const config = getConfig();
  validateEnvForSheets(config);

  try {
    await initializeSheets(config.googleCredentialsPath!, config.googleSheetsId!);
    const { usUsers, vfsUsers } = await getSheetHeaders();
    logger.info('US_users header:');
    logger.info(JSON.stringify(usUsers));
    logger.info('VFS users header:');
    logger.info(JSON.stringify(vfsUsers));
  } catch (error) {
    logger.error(`Failed to read headers: ${formatErrorForLog(error)}`);
    throw error;
  }
}
