import { getConfig, validateEnvForSheets } from '../lib/config';
import {
  initializeSheets,
  readUsers,
  readAvailableDatesCache,
  logBookingAttempt,
  updateAvailableDate,
} from '../lib/sheets';
import { logger } from '../lib/logger';
import { formatErrorForLog } from '../lib/utils';

export async function testSheetsCommand(): Promise<void> {
  const config = getConfig();
  validateEnvForSheets(config);

  logger.info('Starting Google Sheets connectivity test...');
  logger.info('='.repeat(60));

  try {
    logger.info('\n[1/5] Initializing Google Sheets connection...');
    await initializeSheets(
      config.googleCredentialsPath!,
      config.googleSheetsId!
    );
    logger.info('✅ Google Sheets initialized successfully');

    logger.info('\n[2/5] Testing read access to Users sheet...');
    try {
      const users = await readUsers();
      logger.info(`✅ Successfully read Users sheet`);
      logger.info(`   Found ${users.length} active user(s)`);
      if (users.length > 0) {
        logger.info(`   First user: ${users[0].email}`);
      } else {
        logger.info('   ⚠️  No active users found (make sure "active" column is set to TRUE)');
      }
    } catch (error) {
      logger.info(`❌ Failed to read Users sheet: ${formatErrorForLog(error)}`);
      throw error;
    }

    logger.info('\n[3/5] Testing read access to Available Dates Cache sheet...');
    try {
      const cache = await readAvailableDatesCache();
      logger.info(`✅ Successfully read Cache sheet`);
      logger.info(`   Found ${cache.length} cache entry/entries`);
    } catch (error) {
      logger.info(`❌ Failed to read Cache sheet: ${formatErrorForLog(error)}`);
      throw error;
    }

    logger.info('\n[4/5] Testing write access to Available Dates Cache sheet...');
    try {
      const testDate = '2099-12-31';
      await updateAvailableDate(testDate, false, [], config.facilityId);
      logger.info(`✅ Successfully wrote test entry to Cache sheet`);
      logger.info(`   Test date: ${testDate} (you can delete this later)`);
    } catch (error) {
      logger.info(`❌ Failed to write to Cache sheet: ${formatErrorForLog(error)}`);
      throw error;
    }

    logger.info('\n[5/5] Testing write access to Booking Attempts Log sheet...');
    try {
      await logBookingAttempt({
        user_email: 'test@example.com',
        date_attempted: '2099-12-31',
        result: 'test',
        reason: 'This is a test entry - can be deleted',
        old_date: '',
        new_date: '',
      });
      logger.info(`✅ Successfully wrote test entry to Logs sheet`);
      logger.info(`   Test entry added (you can delete this later)`);
    } catch (error) {
      logger.info(`❌ Failed to write to Logs sheet: ${formatErrorForLog(error)}`);
      throw error;
    }

    logger.info('\n' + '='.repeat(60));
    logger.info('✅ ALL TESTS PASSED!');
    logger.info('='.repeat(60));
    logger.info('\nYour Google Sheets setup is working correctly.');
    logger.info('You can now run: npm start -- monitor');
    logger.info('\nNote: Test entries were added to Cache and Logs sheets.');
    logger.info('You can delete them manually if desired.');
  } catch (error) {
    const e = error as Error & { response?: { status?: number; statusText?: string; data?: unknown }; stack?: string };
    logger.info('\n' + '='.repeat(60));
    logger.info('❌ TEST FAILED');
    logger.info('='.repeat(60));
    logger.info(`\nError: ${formatErrorForLog(error)}`);

    if (e.response) {
      logger.info(`\nFull error details:`);
      logger.info(`Status: ${e.response.status ?? 'N/A'}`);
      logger.info(`Status Text: ${e.response.statusText ?? 'N/A'}`);
      if (e.response.data) {
        logger.info(`Error Details: ${JSON.stringify(e.response.data, null, 2)}`);
      }
    }

    if (e.stack) {
      logger.info(`\nStack trace (for debugging):`);
      logger.info(e.stack);
    }

    const errMsg = formatErrorForLog(e);
    if (errMsg.includes('credentials') || errMsg.includes('ENOENT')) {
      logger.info('\n🔧 Troubleshooting - Credentials:');
      logger.info('1. Check that GOOGLE_CREDENTIALS_PATH points to a valid JSON file');
      logger.info(`   Current path: ${config.googleCredentialsPath}`);
      logger.info('2. Verify the service account JSON file is correct');
      logger.info('3. Make sure the file exists at the specified path');
    } else if (
      errMsg.includes('spreadsheet') ||
      errMsg.includes('404') ||
      e.response?.status === 404
    ) {
      logger.info('\n🔧 Troubleshooting - Spreadsheet Not Found:');
      logger.info('1. Check that GOOGLE_SHEETS_ID is correct');
      logger.info(`   Current ID: ${config.googleSheetsId}`);
      logger.info('2. Get the ID from the spreadsheet URL:');
      logger.info('   https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit');
      logger.info('3. Verify the spreadsheet exists and is accessible');
      logger.info('4. Make sure the service account email has Editor access');
      logger.info('   (Share the spreadsheet with the service account email)');
    } else if (
      errMsg.includes('permission') ||
      errMsg.includes('403') ||
      e.response?.status === 403
    ) {
      logger.info('\n🔧 Troubleshooting - Permission Denied:');
      logger.info('1. The service account needs Editor access to the spreadsheet');
      logger.info('2. Share the spreadsheet with the service account email');
      logger.info('3. The service account email is in your credentials.json file');
      logger.info('   (look for "client_email" field)');
      logger.info('4. Make sure you clicked "Send" after sharing');
    } else if (errMsg.includes('Unable to parse range') || errMsg.includes('sheet')) {
      logger.info('\n🔧 Troubleshooting - Sheet Not Found:');
      logger.info('1. Make sure you have created these sheets in your spreadsheet:');
      logger.info('   - "Users"');
      logger.info('   - "Available Dates Cache"');
      logger.info('   - "Booking Attempts Log"');
      logger.info('2. Sheet names must match exactly (case-sensitive)');
      logger.info('3. The bot will try to create headers automatically');
    }

    logger.info('\n💡 Quick Check:');
    logger.info(`- Spreadsheet ID: ${config.googleSheetsId ? '✅ Set' : '❌ Missing'}`);
    logger.info(`- Credentials path: ${config.googleCredentialsPath ? '✅ Set' : '❌ Missing'}`);

    process.exit(1);
  }
}
