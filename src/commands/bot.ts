import { Bot } from '../lib/bot';
import { getConfig } from '../lib/config';
import { log, sleep, isSocketHangupError, formatErrorForLog } from '../lib/utils';

const COOLDOWN = 3600; // 1 hour in seconds

export interface BotCommandOptions {
  dryRun?: boolean;
  current?: string;
  target?: string;
  min?: string;
}

export async function botCommand(options: BotCommandOptions): Promise<void> {
  const config = getConfig();
  const bot = new Bot(config as import('../lib/bot').BotConfig, { dryRun: options.dryRun });
  let currentBookedDate = options.current ?? null;
  const targetDate = options.target;
  const minDate = options.min;

  log(`Initializing with current date ${currentBookedDate}`);

  if (options.dryRun) {
    log(`[DRY RUN MODE] Bot will only log what would be booked without actually booking`);
  }

  if (targetDate) {
    log(`Target date: ${targetDate}`);
  }

  if (minDate) {
    log(`Minimum date: ${minDate}`);
  }

  try {
    const sessionHeaders = await bot.initialize();

    while (true) {
      const availableDate = await bot.checkAvailableDate(
        sessionHeaders,
        currentBookedDate,
        minDate ?? null
      );

      if (availableDate) {
        const result = await bot.bookAppointment(sessionHeaders, availableDate);

        if (result && result.success) {
          currentBookedDate = availableDate;

          options = {
            ...options,
            current: currentBookedDate,
          };

          if (targetDate && availableDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    const errMsg = formatErrorForLog(err);
    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${errMsg}. Trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else {
      log(`Session/authentication error: ${errMsg}. Retrying immediately...`);
    }
    return botCommand(options);
  }
}
