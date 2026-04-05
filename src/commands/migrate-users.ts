/**
 * Copy rows from legacy "Users" sheet into "US_users" (AIS columns only).
 */
import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, migrateUsersFromLegacySheet } from '../lib/sheets';
import { logger } from '../lib/logger';

export async function migrateUsersCommand(): Promise<void> {
  const config = getConfig();
  validateEnvForSheets(config);
  await initializeSheets(config.googleCredentialsPath!, config.googleSheetsId!);
  const { migrated } = await migrateUsersFromLegacySheet();
  logger.info(`migrate-users: copied ${migrated} row(s) from legacy Users → US_users`);
}
