import { getConfig, validateMultiUserConfig } from '../lib/config.js';
import { initializeSheets, readUsers } from '../lib/sheets.js';
import { initializeTelegram } from '../lib/telegram.js';
import { UserBotManager } from '../lib/userBotManager.js';
import { log, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds

export async function monitorCommand(options = {}) {
  const config = getConfig();
  
  // Validate multi-user config
  validateMultiUserConfig(config);

  // Override config with command line options if provided
  if (options.refreshInterval) {
    config.refreshInterval = Number(options.refreshInterval);
  }
  if (options.sheetsRefresh) {
    config.sheetsRefreshInterval = Number(options.sheetsRefresh);
  }

  log('Initializing multi-user monitoring system...');
  log(`Refresh interval: ${config.refreshInterval}s`);
  log(`Sheets refresh interval: ${config.sheetsRefreshInterval}s`);
  log(`Cache TTL: ${config.cacheTtl}s`);
  log(`Rotation cooldown: ${config.rotationCooldown}s`);

  try {
    // Initialize Google Sheets
    await initializeSheets(config.googleCredentialsPath, config.googleSheetsId);
    log('Google Sheets initialized');

    // Initialize Telegram
    initializeTelegram(config.telegramBotToken, config.telegramManagerChatId);
    log('Telegram initialized');

    // Read users from Sheets
    const users = await readUsers();
    
    if (users.length === 0) {
      log('No active users found in Google Sheets');
      process.exit(1);
    }

    log(`Found ${users.length} active users`);

    // Create user bot manager
    const manager = new UserBotManager(config);
    await manager.initializeUsers(users);

    // Start monitoring loop
    log('Starting monitoring loop...');
    await manager.monitorWithRotation();

  } catch (err) {
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      await new Promise(resolve => setTimeout(resolve, COOLDOWN * 1000));
      return monitorCommand(options);
    } else {
      log(`Error: ${err.message}`);
      log(err.stack);
      process.exit(1);
    }
  }
}
