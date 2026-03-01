import type { VisaProvider, VisaCredentials, ProviderSession } from '../ports/VisaProvider.js';

/**
 * Client-shaped wrapper around VisaProvider for use with existing Bot.
 * Session is stored after login() and used by checkAvailableDate, checkAvailableTime, and book
 * when the caller does not pass headers. Callers may pass headers for compatibility (e.g. same
 * interface as VisaHttpClient); if omitted or undefined, the stored session is used.
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

  private requireSession(headers: ProviderSession | null | undefined): ProviderSession {
    const session = headers ?? this.session;
    if (session == null) {
      throw new Error('ProviderBackedClient: not logged in and no session provided. Call login() first.');
    }
    return session;
  }

  async checkAvailableDate(
    headers: ProviderSession | null | undefined,
    scheduleId: string,
    facilityId: number
  ): Promise<string[]> {
    const session = this.requireSession(headers);
    return this.provider.getAvailableDates(session, scheduleId, facilityId);
  }

  async checkAvailableTime(
    headers: ProviderSession | null | undefined,
    scheduleId: string,
    facilityId: number,
    date: string
  ): Promise<string | null | undefined> {
    const session = this.requireSession(headers);
    return this.provider.getAvailableTime(session, scheduleId, facilityId, date);
  }

  async book(
    headers: ProviderSession | null | undefined,
    scheduleId: string,
    facilityId: number,
    date: string,
    time: string
  ): Promise<void> {
    const session = this.requireSession(headers);
    await this.provider.book(session, scheduleId, facilityId, date, time);
  }
}
