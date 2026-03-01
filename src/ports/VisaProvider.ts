/**
 * Credentials for provider login.
 */
export interface VisaCredentials {
  email: string;
  password: string;
  countryCode: string;
  scheduleId?: string;
  facilityId?: number;
}

/**
 * Session returned after login (provider-specific: cookies/headers or wrapper).
 * Adapters know the concrete shape (e.g. AIS: { _client, _headers }).
 */
export type ProviderSession = Record<string, unknown>;

/**
 * Port: visa appointment provider (AIS, VFS Global, etc.).
 * Implementations handle HTTP, captcha, and provider-specific APIs.
 * @implemented_by AisProvider (lib/providers/ais), VfsGlobalProviderAdapter (adapters)
 */
export interface VisaProvider {
  readonly name: string;

  login(credentials: VisaCredentials): Promise<ProviderSession>;

  getAvailableDates(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number
  ): Promise<string[]>;

  getAvailableTime(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string
  ): Promise<string | null>;

  book(
    session: ProviderSession,
    scheduleId: string,
    facilityId: number,
    date: string,
    time: string
  ): Promise<void>;
}
