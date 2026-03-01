import type { VisaProvider, VisaCredentials, ProviderSession } from '../ports/VisaProvider.js';
import { VfsGlobalClient } from '../lib/providers/vfsglobal.js';

const PROVIDER_NAME = 'vfsglobal';

/** Valid VFS session shape (created by this adapter's login()). Compatible with ProviderSession. */
interface VfsSession extends Record<string, unknown> {
  _client: VfsGlobalClient;
  _headers: Record<string, string>;
}

function isVfsSession(session: ProviderSession): session is VfsSession {
  if (session == null || typeof session !== 'object') return false;
  const s = session as Record<string, unknown>;
  return (
    '_client' in session &&
    '_headers' in session &&
    s._client != null &&
    typeof s._client === 'object' &&
    s._headers != null &&
    typeof s._headers === 'object'
  );
}

function assertVfsSession(session: ProviderSession): asserts session is VfsSession {
  if (!isVfsSession(session)) {
    throw new Error('Invalid VFS session: missing or invalid _client or _headers');
  }
}

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
    const client = new VfsGlobalClient({
      locale: credentials.countryCode,
      email: credentials.email,
      password: credentials.password,
      captchaApiKey: this.options.captchaApiKey ?? undefined,
      captchaSolver: this.options.captchaSolver ?? undefined,
    });
    const headers = await client.login();
    const session: VfsSession = { _client: client, _headers: headers };
    return session;
  }

  async getAvailableDates(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number
  ): Promise<string[]> {
    assertVfsSession(session);
    const dates = await session._client.checkAvailableDate(
      session._headers,
      scheduleId,
      facilityId
    );
    return dates ?? [];
  }

  async getAvailableTime(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string
  ): Promise<string | null> {
    assertVfsSession(session);
    return session._client.checkAvailableTime(
      session._headers,
      scheduleId,
      facilityId,
      date
    );
  }

  async book(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string,
    time: string
  ): Promise<void> {
    assertVfsSession(session);
    await session._client.book(
      session._headers,
      scheduleId,
      facilityId,
      date,
      time
    );
  }
}
