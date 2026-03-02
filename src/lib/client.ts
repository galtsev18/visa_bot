import cheerio from 'cheerio';
import { getBaseUri } from './config';

const REQUEST_TIMEOUT_MS = 30 * 1000; // 30s so we get ETIMEDOUT/AbortError instead of long hang

// Common headers
const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Cache-Control': 'no-store',
};

export class VisaHttpClient {
  baseUri: string;
  email: string;
  password: string;

  constructor(countryCode: string, email: string, password: string) {
    this.baseUri = getBaseUri(countryCode);
    this.email = email;
    this.password = password;
  }

  // Public API methods
  async login(): Promise<Record<string, string>> {
    const anonymousHeaders = await this._anonymousRequest(`${this.baseUri}/users/sign_in`).then(
      (response) => this._extractHeaders(response)
    );

    const loginData: Record<string, string> = {
      utf8: '✓',
      'user[email]': this.email,
      'user[password]': this.password,
      policy_confirmed: '1',
      commit: 'Sign In',
    };

    return this._submitForm(`${this.baseUri}/users/sign_in`, anonymousHeaders, loginData).then(
      (res) => ({
        ...anonymousHeaders,
        Cookie: this._extractRelevantCookies(res),
      })
    );
  }

  async checkAvailableDate(
    headers: Record<string, string>,
    scheduleId: string,
    facilityId: string | number
  ): Promise<string[]> {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false`;

    return this._jsonRequest(url, headers).then((data) =>
      (data as Array<{ date: string }>).map((item) => item.date)
    );
  }

  async checkAvailableTime(
    headers: Record<string, string>,
    scheduleId: string,
    facilityId: string | number,
    date: string
  ): Promise<string | null> {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false`;

    return this._jsonRequest(url, headers).then((data) => {
      const d = data as { business_times?: string[]; available_times?: string[] };
      return d['business_times']?.[0] ?? d['available_times']?.[0] ?? null;
    });
  }

  async book(
    headers: Record<string, string>,
    scheduleId: string,
    facilityId: string | number,
    date: string,
    time: string
  ): Promise<void> {
    const url = `${this.baseUri}/schedule/${scheduleId}/appointment`;

    const bookingHeaders = await this._anonymousRequest(url, headers).then((response) =>
      this._extractHeaders(response)
    );

    const bookingData: Record<string, string> = {
      utf8: '✓',
      authenticity_token: bookingHeaders['X-CSRF-Token'] ?? '',
      confirmed_limit_message: '1',
      use_consulate_appointment_capacity: 'true',
      'appointments[consulate_appointment][facility_id]': String(facilityId),
      'appointments[consulate_appointment][date]': date,
      'appointments[consulate_appointment][time]': time,
      'appointments[asc_appointment][facility_id]': '',
      'appointments[asc_appointment][date]': '',
      'appointments[asc_appointment][time]': '',
    };

    await this._submitFormWithRedirect(url, bookingHeaders, bookingData);
  }

  // Private request methods
  _fetchWithTimeout(
    url: string,
    options: {
      timeout?: number;
      headers?: Record<string, string>;
      method?: string;
      redirect?: 'follow' | 'manual';
      body?: URLSearchParams;
      cache?: RequestCache;
    } = {}
  ): Promise<Response> {
    const timeoutMs = options.timeout ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const { timeout: _timeout, ...rest } = options;
    return fetch(url, { ...rest, signal: controller.signal }).finally(() =>
      clearTimeout(timeoutId)
    ) as Promise<Response>;
  }

  async _anonymousRequest(url: string, headers: Record<string, string> = {}): Promise<Response> {
    return this._fetchWithTimeout(url, {
      headers: {
        'User-Agent': '',
        Accept: '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        ...headers,
      },
    });
  }

  async _jsonRequest(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<Record<string, unknown> | Array<unknown>> {
    return this._fetchWithTimeout(url, {
      headers: {
        ...headers,
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((r) => this._handleErrors(r as Record<string, unknown>));
  }

  async _submitForm(
    url: string,
    headers: Record<string, string> = {},
    formData: Record<string, string> = {}
  ): Promise<Response> {
    return this._fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams(formData),
    });
  }

  async _submitFormWithRedirect(
    url: string,
    headers: Record<string, string> = {},
    formData: Record<string, string> = {}
  ): Promise<Response> {
    return this._fetchWithTimeout(url, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(formData),
    });
  }

  // Private utility methods
  async _extractHeaders(res: Response): Promise<Record<string, string>> {
    const cookies = this._extractRelevantCookies(res);
    const html = await res.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content') ?? '';

    return {
      ...COMMON_HEADERS,
      Cookie: cookies,
      'X-CSRF-Token': csrfToken,
      Referer: this.baseUri,
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
  }

  _extractRelevantCookies(res: Response): string {
    const parsedCookies = this._parseCookies(res.headers.get('set-cookie') ?? '');
    return `_yatri_session=${parsedCookies['_yatri_session'] ?? ''}`;
  }

  _parseCookies(cookies: string): Record<string, string> {
    const parsedCookies: Record<string, string> = {};

    cookies
      .split(';')
      .map((c) => c.trim())
      .forEach((c) => {
        const [name, value] = c.split('=', 2);
        if (name && value) parsedCookies[name] = value;
      });

    return parsedCookies;
  }

  _handleErrors<T>(response: T & { error?: string }): T {
    const errorMessage = response['error'];

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return response;
  }
}
