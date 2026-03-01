import { getConfig, validateEnvForSheets } from '../lib/config.js';
import { initializeSheets, readUsers, readAvailableDatesCache, logBookingAttempt, updateAvailableDate } from '../lib/sheets.js';
import { log } from '../lib/utils.js';

export async function testSheetsCommand() {
  const config = getConfig();
  validateEnvForSheets(config);

  log('Starting Google Sheets connectivity test...');
  log('='.repeat(60));

  try {
    // Step 1: Initialize Sheets
    log('\n[1/5] Initializing Google Sheets connection...');
    await initializeSheets(config.googleCredentialsPath, config.googleSheetsId);
    log('✅ Google Sheets initialized successfully');

    // Step 2: Test reading Users sheet
    log('\n[2/5] Testing read access to Users sheet...');
    try {
      const users = await readUsers();
      log(`✅ Successfully read Users sheet`);
      log(`   Found ${users.length} active user(s)`);
      if (users.length > 0) {
        log(`   First user: ${users[0].email}`);
      } else {
        log('   ⚠️  No active users found (make sure "active" column is set to TRUE)');
      }
    } catch (error) {
      log(`❌ Failed to read Users sheet: ${error.message}`);
      throw error;
    }

    // Step 3: Test reading Cache sheet
    log('\n[3/5] Testing read access to Available Dates Cache sheet...');
    try {
      const cache = await readAvailableDatesCache();
      log(`✅ Successfully read Cache sheet`);
      log(`   Found ${cache.length} cache entry/entries`);
    } catch (error) {
      log(`❌ Failed to read Cache sheet: ${error.message}`);
      throw error;
    }

    // Step 4: Test writing to Cache sheet
    log('\n[4/5] Testing write access to Available Dates Cache sheet...');
    try {
      const testDate = '2099-12-31'; // Far future date for testing
      await updateAvailableDate(testDate, false, [], config.facilityId);
      log(`✅ Successfully wrote test entry to Cache sheet`);
      log(`   Test date: ${testDate} (you can delete this later)`);
    } catch (error) {
      log(`❌ Failed to write to Cache sheet: ${error.message}`);
      throw error;
    }

    // Step 5: Test writing to Logs sheet
    log('\n[5/5] Testing write access to Booking Attempts Log sheet...');
    try {
      await logBookingAttempt({
        user_email: 'test@example.com',
        date_attempted: '2099-12-31',
        result: 'test',
        reason: 'This is a test entry - can be deleted',
        old_date: '',
        new_date: ''
      });
      log(`✅ Successfully wrote test entry to Logs sheet`);
      log(`   Test entry added (you can delete this later)`);
    } catch (error) {
      log(`❌ Failed to write to Logs sheet: ${error.message}`);
      throw error;
    }

    // Summary
    log('\n' + '='.repeat(60));
    log('✅ ALL TESTS PASSED!');
    log('='.repeat(60));
    log('\nYour Google Sheets setup is working correctly.');
    log('You can now run: node src/index.js monitor');
    log('\nNote: Test entries were added to Cache and Logs sheets.');
    log('You can delete them manually if desired.');

  } catch (error) {
    log('\n' + '='.repeat(60));
    log('❌ TEST FAILED');
    log('='.repeat(60));
    log(`\nError: ${error.message}`);
    
    // Show full error details if available
    if (error.response) {
      log(`\nFull error details:`);
      log(`Status: ${error.response.status || 'N/A'}`);
      log(`Status Text: ${error.response.statusText || 'N/A'}`);
      if (error.response.data) {
        log(`Error Details: ${JSON.stringify(error.response.data, null, 2)}`);
      }
    }
    
    if (error.stack) {
      log(`\nStack trace (for debugging):`);
      log(error.stack);
    }
    
    // Specific error handling
    if (error.message.includes('credentials') || error.message.includes('ENOENT')) {
      log('\n🔧 Troubleshooting - Credentials:');
      log('1. Check that GOOGLE_CREDENTIALS_PATH points to a valid JSON file');
      log(`   Current path: ${config.googleCredentialsPath}`);
      log('2. Verify the service account JSON file is correct');
      log('3. Make sure the file exists at the specified path');
    } else if (error.message.includes('spreadsheet') || error.message.includes('404') || error.response?.status === 404) {
      log('\n🔧 Troubleshooting - Spreadsheet Not Found:');
      log('1. Check that GOOGLE_SHEETS_ID is correct');
      log(`   Current ID: ${config.googleSheetsId}`);
      log('2. Get the ID from the spreadsheet URL:');
      log('   https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit');
      log('3. Verify the spreadsheet exists and is accessible');
      log('4. Make sure the service account email has Editor access');
      log('   (Share the spreadsheet with the service account email)');
    } else if (error.message.includes('permission') || error.message.includes('403') || error.response?.status === 403) {
      log('\n🔧 Troubleshooting - Permission Denied:');
      log('1. The service account needs Editor access to the spreadsheet');
      log('2. Share the spreadsheet with the service account email');
      log('3. The service account email is in your credentials.json file');
      log('   (look for "client_email" field)');
      log('4. Make sure you clicked "Send" after sharing');
    } else if (error.message.includes('Unable to parse range') || error.message.includes('sheet')) {
      log('\n🔧 Troubleshooting - Sheet Not Found:');
      log('1. Make sure you have created these sheets in your spreadsheet:');
      log('   - "Users"');
      log('   - "Available Dates Cache"');
      log('   - "Booking Attempts Log"');
      log('2. Sheet names must match exactly (case-sensitive)');
      log('3. The bot will try to create headers automatically');
    }
    
    log('\n💡 Quick Check:');
    log(`- Spreadsheet ID: ${config.googleSheetsId ? '✅ Set' : '❌ Missing'}`);
    log(`- Credentials path: ${config.googleCredentialsPath ? '✅ Set' : '❌ Missing'}`);
    
    process.exit(1);
  }
}
