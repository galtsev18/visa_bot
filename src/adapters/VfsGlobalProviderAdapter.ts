import type { VisaProvider, VisaCredentials, ProviderSession } from '../ports/VisaProvider.js';
import { VfsGlobalClient } from '../lib/providers/vfsglobal.js';

const PROVIDER_NAME = 'vfsglobal';

/**
 * Options for VFS Global (captcha, etc.).
 */
export interface VfsGlobalProviderOptions {
  captchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
}

/**
 * Wraps VfsGlobalClient to implement VisaProvider.
 * Client is created per login() with credentials + options.
 */
export class VfsGlobalProviderAdapter implements VisaProvider {
  readonly name = PROVIDER_NAME;

  constructor(private readonly options: VfsGlobalProviderOptions = {}) {}

  async login(credentials: VisaCredentials): Promise<ProviderSession> {
    const client = new VfsGlobalClient(
      {
        locale: credentials.countryCode,
        email: credentials.email,
        password: credentials.password,
        captchaApiKey: this.options.captchaApiKey ?? undefined,
        captchaSolver: this.options.captchaSolver ?? undefined,
      }
    );
    const headers = await client.login();
    return { _client: client, _headers: headers } as ProviderSession;
  }

  async getAvailableDates(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number
  ): Promise<string[]> {
    const client = (session as { _client: VfsGlobalClient })._client;
    const headers = (session as { _headers: Record<string, string> })._headers;
    if (!client || !headers) throw new Error('Invalid VFS session');
    const dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
    return dates ?? [];
  }

  async getAvailableTime(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string
  ): Promise<string | null> {
    const client = (session as { _client: VfsGlobalClient })._client;
    const headers = (session as { _headers: Record<string, string> })._headers;
    if (!client || !headers) throw new Error('Invalid VFS session');
    return client.checkAvailableTime(headers, scheduleId, facilityId, date);
  }

  async book(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string,
    time: string
  ): Promise<void> {
    const client = (session as { _client: VfsGlobalClient })._client;
    const headers = (session as { _headers: Record<string, string> })._headers;
    if (!client || !headers) throw new Error('Invalid VFS session');
    await client.book(headers, scheduleId, facilityId, date, time);
  }
}
