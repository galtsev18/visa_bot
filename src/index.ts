#!/usr/bin/env node

import { program } from 'commander';
import { logger } from './lib/logger';
import { formatErrorForLog } from './lib/utils';
import { botCommand } from './commands/bot';
import { monitorCommand } from './commands/monitor';
import { getChatIdCommand } from './commands/get-chat-id';
import { testSheetsCommand } from './commands/test-sheets';
import { testVfsCaptchaCommand } from './commands/test-vfs-captcha';
import { healthCommand } from './commands/health';
import { migrateUsersCommand } from './commands/migrate-users';
import { updateSettingsTimingsCommand } from './commands/update-settings-timings';
import { showSheetHeadersCommand } from './commands/show-sheet-headers';
import { getVfsLoginCredentialsCommand } from './commands/get-vfs-login-credentials';
import { captureVfsFormRequestsCommand } from './commands/capture-vfs-form-requests';
import { listVfsDatesCommand } from './commands/list-vfs-dates';
import { vfsLoginDebugCaptureCommand } from './commands/vfsLoginDebugCapture';
import { patchCacheAvailableBooleansCommand } from './commands/patch-cache-available-booleans';

// CLI boundary: avoid raw stack dumps for unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, `Unhandled rejection: ${formatErrorForLog(reason)}`);
  process.exit(1);
});

program
  .name('us-visa-bot')
  .description('Automated US visa appointment rescheduling bot')
  .version('0.0.1');

program
  .command('monitor')
  .description('Monitor multiple users from Google Sheets')
  .option('--refresh-interval <seconds>', 'Seconds between user checks', '3')
  .option('--sheets-refresh <seconds>', 'Seconds between reading Google Sheets', '300')
  .action((opts) => monitorCommand(opts as { refreshInterval?: string; sheetsRefresh?: string }));

program
  .command('get-chat-id')
  .description('Get your Telegram chat ID by sending a message to the bot')
  .action(() => getChatIdCommand());

program
  .command('test-sheets')
  .description('Test Google Sheets read/write access')
  .action(() => testSheetsCommand());

program
  .command('migrate-users')
  .description('Copy all rows from legacy "Users" sheet to "US_users" (AIS columns only)')
  .action(() => migrateUsersCommand());

program
  .command('update-settings-timings')
  .description('Write timing defaults (5, 400, 90, 45) into the Settings sheet')
  .action(() => updateSettingsTimingsCommand());

program
  .command('patch-cache-available-booleans')
  .description(
    'One-time: replace text TRUE/FALSE in Available Dates Cache column "available" with real boolean cells'
  )
  .option('--dry-run', 'Only print how many cells would be fixed (no write)')
  .action((opts: { dryRun?: boolean }) => patchCacheAvailableBooleansCommand(opts));

program
  .command('show-sheet-headers')
  .description('Print header row of US_users and VFS users sheets')
  .action(() => showSheetHeadersCommand());

program
  .command('get-vfs-login-credentials')
  .description('Write first VFS user email/password from Sheets to .tmp/vfs-login.json (for browser login)')
  .action(async () => {
    await getVfsLoginCredentialsCommand();
  });

program
  .command('capture-vfs-form-requests')
  .description('Puppeteer: log in to VFS, run Start New Booking + select options, capture XHR/fetch to .tmp/vfs-captured-requests.json')
  .option('--visible', 'Show browser window (solve captcha manually)')
  .option(
    '--with-time',
    'After dates load, click first date and read time slots (captures slot/booking-related XHR)'
  )
  .action((opts: { visible?: boolean; withTime?: boolean }) => captureVfsFormRequestsCommand(opts));

program
  .command('list-vfs-dates')
  .description(
    'VFS only: browser login from .tmp/vfs-login.json, then print available interview dates (same algorithm as monitor; use for manual checks)'
  )
  .option('--visible', 'Show browser (manual captcha / Cloudflare)')
  .option('--no-proxy', 'Do not use VFS_PROXY_URL / Geonix (if proxy auth fails or you test locally)')
  .action((opts: { visible?: boolean; proxy?: boolean }) => listVfsDatesCommand(opts));

program
  .command('vfs-login-debug')
  .description(
    'Open VFS login in a headed browser, log CDP network + console + per-frame DOM/HTML snapshots to .tmp/vfs-login-debug/ — press Ctrl+C when done (you solve captcha manually). Uses VFS/Geonix proxy from Settings like list-vfs-dates unless --no-proxy'
  )
  .option('--url <url>', 'Login URL (default: loginUrl from .tmp/vfs-login.json)')
  .option('--interval <sec>', 'Seconds between automatic snapshots', '5')
  .option('--html-max <n>', 'Max characters of outerHTML per frame in each snapshot', '80000')
  .option('--no-proxy', 'Do not use VFS_PROXY_URL / Geonix (direct connection)')
  .action((opts: { url?: string; interval?: string; htmlMax?: string; proxy?: boolean }) =>
    vfsLoginDebugCaptureCommand(opts)
  );

program
  .command('test-vfs-captcha')
  .description(
    'Test VFS login page: detect captcha type and optionally solve it (no login unless --email and --password)'
  )
  .option('--browser', 'Use browser (Puppeteer) to try to pass Cloudflare')
  .option('--visible', 'Show browser window (use with --browser; Cloudflare may pass more often)')
  .option(
    '--screenshot [path]',
    'Save screenshot of rendered page (use with --browser); default: vfs-page-screenshot.png'
  )
  .option('--solve', 'Solve captcha via 2Captcha (requires CAPTCHA_2CAPTCHA_API_KEY)')
  .option('--email <email>', 'Email for login attempt (use with --solve and --password)')
  .option('--password <password>', 'Password for login attempt')
  .action((opts) =>
    testVfsCaptchaCommand(opts as import('./commands/test-vfs-captcha').TestVfsCaptchaOptions)
  );

program
  .command('health')
  .description('Health check: print status and exit 0')
  .action(() => healthCommand());

program
  .command('bot')
  .description('Monitor and reschedule visa appointments (single user)')
  .requiredOption('-c, --current <date>', 'current booked date')
  .option('-t, --target <date>', 'target date to stop at')
  .option('-m, --min <date>', 'minimum date acceptable')
  .option('--dry-run', 'only log what would be booked without actually booking')
  .action((opts) =>
    botCommand(opts as import('./commands/bot').BotCommandOptions)
  );

program.parseAsync().catch((err) => {
  logger.error({ err }, `Command failed: ${formatErrorForLog(err)}`);
  process.exit(1);
});
