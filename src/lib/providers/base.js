/**
 * Base provider interface for visa appointment systems.
 * Each provider (AIS, VFS Global, etc.) implements these methods.
 *
 * @typedef {Object} ProviderSession - Session/headers after login (provider-specific)
 *
 * @interface VisaProvider
 * @property {string} name - Provider identifier, e.g. 'ais', 'vfsglobal'
 *
 * login(credentials: Object): Promise<ProviderSession>
 *   - credentials: { email, password, countryCode?, scheduleId?, facilityId?, ... }
 *   - Returns session (cookies/headers) for subsequent requests.
 *   - May require captcha solving; provider can use captcha solver or throw with instructions.
 *
 * getAvailableDates(session, scheduleId, facilityId): Promise<string[]>
 *   - Returns array of date strings (YYYY-MM-DD).
 *
 * getAvailableTime(session, scheduleId, facilityId, date): Promise<string|null>
 *   - Returns first available time for the date, or null.
 *
 * book(session, scheduleId, facilityId, date, time): Promise<void>
 *   - Submits booking. Throws on failure.
 */

export const PROVIDER_NAMES = Object.freeze({
  AIS: 'ais',
  VFSGLOBAL: 'vfsglobal',
});
