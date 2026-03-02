import { Bot } from '../lib/bot';
import { getConfig } from '../lib/config';
import { logger } from '../lib/logger';
import { sleep, isSocketHangupError, formatErrorForLog } from '../lib/utils';
import { createVisaProvider } from '../adapters/VisaProviderFactory';
import { ProviderBackedClient } from '../adapters/ProviderBackedClient';

const COOLDOWN = 3600; // 1 hour in seconds

export interface BotCommandOptions {
  dryRun?: boolean;
  current?: string;
  target?: string;
  min?: string;
}

export async function botCommand(options: BotCommandOptions): Promise<void> {
  const config = getConfig();
  const providerId = (config as { provider?: string }).provider ?? 'ais';
  const provider = createVisaProvider(providerId, {
    captcha2CaptchaApiKey: config.captcha2CaptchaApiKey ?? null,
    captchaSolver: config.captchaSolver ?? null,
  });
  const client = new ProviderBackedClient(provider, {
    email: config.email!,
    password: config.password!,
    countryCode: config.countryCode!,
    scheduleId: config.scheduleId,
    facilityId: config.facilityId,
  });
  const bot = new Bot(config as import('../lib/bot').BotConfig, { client, dryRun: options.dryRun });
  let currentBookedDate = options.current ?? null;
  const targetDate = options.target;
  const minDate = options.min;

  logger.info(`Initializing with current date ${currentBookedDate}`);

  if (options.dryRun) {
    logger.info(`[DRY RUN MODE] Bot will only log what would be booked without actually booking`);
  }

  if (targetDate) {
    logger.info(`Target date: ${targetDate}`);
  }

  if (minDate) {
    logger.info(`Minimum date: ${minDate}`);
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
            logger.info(`Target date reached! Successfully booked appointment on ${availableDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    const errMsg = formatErrorForLog(err);
    if (isSocketHangupError(err)) {
      logger.info(`Socket hangup error: ${errMsg}. Trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else {
      logger.info(`Session/authentication error: ${errMsg}. Retrying immediately...`);
    }
    return botCommand(options);
  }
}
