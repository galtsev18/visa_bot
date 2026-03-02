import { logger } from './logger';

export interface BotClient {
  login(): Promise<Record<string, string> | Record<string, unknown>>;
  checkAvailableDate(
    headers: Record<string, string> | Record<string, unknown>,
    scheduleId: string,
    facilityId: string | number
  ): Promise<string[]>;
  checkAvailableTime(
    headers: Record<string, string> | Record<string, unknown>,
    scheduleId: string,
    facilityId: string | number,
    date: string
  ): Promise<string | null>;
  book(
    headers: Record<string, string> | Record<string, unknown>,
    scheduleId: string,
    facilityId: string | number,
    date: string,
    time: string
  ): Promise<void>;
}

export interface BotConfig {
  countryCode: string;
  email: string;
  password: string;
  scheduleId: string;
  facilityId: number;
  refreshDelay?: number;
  provider?: string;
}

export interface BotOptions {
  dryRun?: boolean;
  /** Required: use ProviderBackedClient from VisaProviderFactory (single entry point for AIS/VFS). */
  client: BotClient;
}

export class Bot {
  config: BotConfig;
  dryRun: boolean;
  client: BotClient;

  constructor(config: BotConfig, options: BotOptions) {
    if (!options?.client) {
      throw new Error('Bot requires options.client (e.g. ProviderBackedClient from createVisaProvider).');
    }
    this.config = config;
    this.dryRun = options.dryRun ?? false;
    this.client = options.client;
  }

  async initialize(): Promise<Record<string, string> | Record<string, unknown>> {
    return (await this.client.login()) as Record<string, string> | Record<string, unknown>;
  }

  async checkAvailableDate(
    sessionHeaders: Record<string, string> | Record<string, unknown>,
    currentBookedDate: string | null,
    minDate?: string | null
  ): Promise<string | null> {
    const dates = await this.client.checkAvailableDate(
      sessionHeaders as Record<string, string>,
      this.config.scheduleId,
      this.config.facilityId
    );

    if (!dates || dates.length === 0) {
      logger.info('no dates available');
      return null;
    }

    // Filter dates that are better than current booked date and after minimum date
    const goodDates = dates.filter((date) => {
      if (currentBookedDate && date >= currentBookedDate) {
        logger.info(`date ${date} is further than already booked (${currentBookedDate})`);
        return false;
      }

      if (minDate && date < minDate) {
        logger.info(`date ${date} is before minimum date (${minDate})`);
        return false;
      }

      return true;
    });

    if (goodDates.length === 0) {
      logger.info('no good dates found after filtering');
      return null;
    }

    // Sort dates and return the earliest one
    goodDates.sort();
    const earliestDate = goodDates[0];

    logger.info(
      `found ${goodDates.length} good dates: ${goodDates.join(', ')}, using earliest: ${earliestDate}`
    );
    return earliestDate;
  }

  /**
   * Book appointment for the given date.
   */
  async bookAppointment(
    sessionHeaders: Record<string, string> | Record<string, unknown>,
    date: string
  ): Promise<{ success: boolean; time?: string }> {
    const time = await this.client.checkAvailableTime(
      sessionHeaders as Record<string, string>,
      this.config.scheduleId,
      this.config.facilityId,
      date
    );

    if (!time) {
      logger.info(`no available time slots for date ${date}`);
      return { success: false };
    }

    if (this.dryRun) {
      logger.info(`[DRY RUN] Would book appointment at ${date} ${time} (not actually booking)`);
      return { success: true, time };
    }

    await this.client.book(
      sessionHeaders as Record<string, string>,
      this.config.scheduleId,
      this.config.facilityId,
      date,
      time
    );

    logger.info(`booked time at ${date} ${time}`);
    return { success: true, time };
  }
}
