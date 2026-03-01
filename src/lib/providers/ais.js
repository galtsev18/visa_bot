import { VisaHttpClient } from '../client.js';
import { getBaseUri } from '../config.js';
import { PROVIDER_NAMES } from './base.js';

/**
 * AIS US Visa (ais.usvisa-info.com) provider.
 * Wraps the existing VisaHttpClient to match the provider interface.
 */
export class AisProvider {
  constructor() {
    this.name = PROVIDER_NAMES.AIS;
  }

  /**
   * @param {{ email: string, password: string, countryCode: string }} credentials
   * @returns {Promise<Record<string, string>>} session headers
   */
  async login(credentials) {
    const client = new VisaHttpClient(
      credentials.countryCode,
      credentials.email,
      credentials.password
    );
    const session = await client.login();
    return { _client: client, _headers: session };
  }

  /**
   * @param {any} session - session from login()
   * @param {string} scheduleId
   * @param {string|number} facilityId
   * @returns {Promise<string[]>}
   */
  async getAvailableDates(session, scheduleId, facilityId) {
    const client = session._client;
    const headers = session._headers;
    if (!client || !headers) throw new Error('Invalid AIS session');
    const dates = await client.checkAvailableDate(headers, scheduleId, facilityId);
    return dates || [];
  }

  /**
   * @param {any} session
   * @param {string} scheduleId
   * @param {string|number} facilityId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<string|null>}
   */
  async getAvailableTime(session, scheduleId, facilityId, date) {
    const client = session._client;
    const headers = session._headers;
    if (!client || !headers) throw new Error('Invalid AIS session');
    return client.checkAvailableTime(headers, scheduleId, facilityId, date);
  }

  /**
   * @param {any} session
   * @param {string} scheduleId
   * @param {string|number} facilityId
   * @param {string} date
   * @param {string} time
   */
  async book(session, scheduleId, facilityId, date, time) {
    const client = session._client;
    const headers = session._headers;
    if (!client || !headers) throw new Error('Invalid AIS session');
    await client.book(headers, scheduleId, facilityId, date, time);
  }
}
