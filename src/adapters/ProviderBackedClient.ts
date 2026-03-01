import type { VisaProvider, VisaCredentials, ProviderSession } from '../ports/VisaProvider.js';

/**
 * Client-shaped wrapper around VisaProvider for use with existing Bot.
 * Bot expects: login() -> session, checkAvailableDate(session, ...), checkAvailableTime(session, ...), book(session, ...).
 */
export class ProviderBackedClient {
  private session: ProviderSession | null = null;

  constructor(
    private readonly provider: VisaProvider,
    private readonly credentials: VisaCredentials
  ) {}

  async login(): Promise<ProviderSession> {
    this.session = await this.provider.login(this.credentials);
    return this.session;
  }

  async checkAvailableDate(
    headers: ProviderSession,
    scheduleId: string,
    facilityId: number
  ): Promise<string[]> {
    return this.provider.getAvailableDates(headers, scheduleId, facilityId);
  }

  async checkAvailableTime(
    headers: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string
  ): Promise<string | null | undefined> {
    return this.provider.getAvailableTime(headers, scheduleId, facilityId, date);
  }

  async book(
    headers: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string,
    time: string
  ): Promise<void> {
    await this.provider.book(headers, scheduleId, facilityId, date, time);
  }
}
