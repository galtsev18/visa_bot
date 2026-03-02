import { VisaHttpClient } from '../client';
import { PROVIDER_NAMES } from './base';

export interface AisCredentials {
  email: string;
  password: string;
  countryCode: string;
}

export interface AisSession extends Record<string, unknown> {
  _client: VisaHttpClient;
  _headers: Record<string, string>;
}

/**
 * AIS US Visa (ais.usvisa-info.com) provider.
 * Wraps the existing VisaHttpClient to match the provider interface.
 */
export class AisProvider {
  name: string;

  constructor() {
    this.name = PROVIDER_NAMES.AIS;
  }

  async login(credentials: AisCredentials): Promise<AisSession> {
    const client = new VisaHttpClient(
      credentials.countryCode,
      credentials.email,
      credentials.password
    );
    const session = await client.login();
    return { _client: client, _headers: session };
  }

  async getAvailableDates(
    session: AisSession,
    scheduleId: string,
    facilityId: string | number
  ): Promise<string[]> {
    const { _client: client, _headers: headers } = session;
    if (!client || !headers) throw new Error('Invalid AIS session');
    const dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
    return dates ?? [];
  }

  async getAvailableTime(
    session: AisSession,
    scheduleId: string,
    facilityId: string | number,
    date: string
  ): Promise<string | null> {
    const { _client: client, _headers: headers } = session;
    if (!client || !headers) throw new Error('Invalid AIS session');
    return client.checkAvailableTime(headers, scheduleId, facilityId, date);
  }

  async book(
    session: AisSession,
    scheduleId: string,
    facilityId: string | number,
    date: string,
    time: string
  ): Promise<void> {
    const { _client: client, _headers: headers } = session;
    if (!client || !headers) throw new Error('Invalid AIS session');
    await client.book(headers, scheduleId, facilityId, date, time);
  }
}
