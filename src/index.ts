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
  .command('test-vfs-captcha')
  .description('Test VFS login page: detect captcha type and optionally solve it')
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
