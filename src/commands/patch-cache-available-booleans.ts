/**
 * One-time patch: "Available Dates Cache" column `available` — legacy text TRUE/FALSE → boolean cells.
 */
import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, patchCacheAvailableTextToBooleans } from '../lib/sheets';
import { logger } from '../lib/logger';

export async function patchCacheAvailableBooleansCommand(options: { dryRun?: boolean }): Promise<void> {
  const config = getConfig();
  validateEnvForSheets(config);
  await initializeSheets(config.googleCredentialsPath!, config.googleSheetsId!);
  const { fixed, unchanged } = await patchCacheAvailableTextToBooleans({
    dryRun: options.dryRun === true,
  });
  console.log(JSON.stringify({ ok: true, dryRun: options.dryRun === true, fixed, unchanged }, null, 2));
  if (options.dryRun && fixed > 0) {
    logger.info('Run without --dry-run to write boolean cells to the sheet.');
  }
}
