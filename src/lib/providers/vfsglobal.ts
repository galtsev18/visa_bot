import cheerio from 'cheerio';
import { logger } from '../logger';
import { formatErrorForLog } from '../utils';
import { solveImageCaptcha, solveRecaptchaV2, solveTurnstile } from '../captcha';
import {
  vfsBrowserLogin,
  vfsGetAvailableDatesFromPage,
  vfsGetAvailableTimeFromPage,
  vfsBookFromPage,
} from './vfsBrowserFlow';

const VFS_BASE_URI = 'https://visa.vfsglobal.com';

export type CaptchaSolver = (params: {
  type: 'image' | 'recaptcha' | 'turnstile';
  imageBase64?: string;
  siteKey?: string;
  pageUrl?: string;
}) => Promise<string>;

export interface VfsConfig {
  locale?: string;
  countryCode?: string;
  email: string;
  password: string;
  captchaSolver?: CaptchaSolver | null;
  captchaApiKey?: string | null;
  /** Visa centre / category / subcategory for appointment search (browser flow). */
  vfsCentre?: string;
  vfsCategory?: string;
  vfsSubcategory?: string;
  /** Prefer browser flow (Puppeteer) for login and dates; use when fetch hits Cloudflare. */
  useBrowser?: boolean;
  /** Proxy for browser (e.g. Russian IP for Russia-only cabinet). */
  proxy?: { server: string; username: string; password: string } | null;
}

/** Browser session held when using Puppeteer flow (not fetch). */
export interface VfsBrowserSession {
  page: unknown;
  browser: unknown;
}

/**
 * VFS Global visa appointment client (visa.vfsglobal.com).
 * Different schema and procedure from AIS; login has captcha.
 * When useBrowser or fetch fails (Cloudflare), uses full browser flow (vfsBrowserFlow).
 */
export class VfsGlobalClient {
  locale: string;
  email: string;
  password: string;
  captchaSolver: CaptchaSolver | null;
  captchaApiKey: string | null;
  baseUri: string;
  vfsCentre: string;
  vfsCategory: string;
  vfsSubcategory: string;
  useBrowser: boolean;
  proxy: { server: string; username: string; password: string } | null;
  /** Set after browser login; used by checkAvailableDate/checkAvailableTime/book. */
  _browserSession: VfsBrowserSession | null = null;

  constructor(
    countryCodeOrConfig: string | VfsConfig,
    email?: string,
    password?: string
  ) {
    if (typeof countryCodeOrConfig === 'object') {
      this.locale =
        countryCodeOrConfig.locale ??
        countryCodeOrConfig.countryCode ??
        'rus/en/fra';
      this.email = countryCodeOrConfig.email;
      this.password = countryCodeOrConfig.password;
      this.captchaSolver = countryCodeOrConfig.captchaSolver ?? null;
      this.captchaApiKey = countryCodeOrConfig.captchaApiKey ?? null;
      this.vfsCentre = countryCodeOrConfig.vfsCentre ?? '';
      this.vfsCategory = countryCodeOrConfig.vfsCategory ?? '';
      this.vfsSubcategory = countryCodeOrConfig.vfsSubcategory ?? '';
      this.useBrowser = countryCodeOrConfig.useBrowser === true;
      this.proxy = countryCodeOrConfig.proxy ?? null;
    } else {
      this.locale = countryCodeOrConfig ?? 'rus/en/fra';
      this.email = email!;
      this.password = password!;
      this.captchaSolver = null;
      this.captchaApiKey = null;
      this.vfsCentre = '';
      this.vfsCategory = '';
      this.vfsSubcategory = '';
      this.useBrowser = false;
      this.proxy = null;
    }
    this.baseUri = `${VFS_BASE_URI}/${this.locale}`.replace(/\/+/g, '/');
  }

  private async _loginWithBrowser(): Promise<Record<string, string>> {
    const solver = this.captchaSolver
      ? (params: unknown) => this.captchaSolver!(params as Parameters<CaptchaSolver>[0])
      : undefined;
    const session = await vfsBrowserLogin({
      locale: this.locale,
      email: this.email,
      password: this.password,
      captchaApiKey: this.captchaApiKey ?? undefined,
      captchaSolver: solver ?? null,
      headless: true,
      timeout: 60000,
      proxy: this.proxy ?? undefined,
    });
    this._browserSession = session;
    logger.info('VFS Global: Browser login successful');
    return {};
  }

  async login(): Promise<Record<string, string>> {
    if (this.useBrowser) {
      return this._loginWithBrowser();
    }
    logger.info('VFS Global: Loading login page...');
    const loginUrl = `${this.baseUri}/login`;
    let res = await fetch(loginUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow' as const,
    });
    let html = await res.text();
    let $ = cheerio.load(html);
    const pageTitle = ($('title').text() || '').trim();
    const bodyText = ($('body').text() || '').toLowerCase();

    const isCloudflare =
      pageTitle.includes('Just a moment') ||
      bodyText.includes('cloudflare') ||
      bodyText.includes('security verification');
    const turnstileSiteKey =
      $('.cf-turnstile[data-sitekey]').attr('data-sitekey') ??
      $('.cf-turnstile').attr('data-sitekey') ??
      (isCloudflare ? $('[data-sitekey]').first().attr('data-sitekey') : null);

    if (isCloudflare && turnstileSiteKey) {
      logger.info('VFS Global: Cloudflare Turnstile challenge detected, solving...');
      const token = this.captchaSolver
        ? await this.captchaSolver({
            type: 'turnstile',
            siteKey: turnstileSiteKey,
            pageUrl: loginUrl,
          })
        : await solveTurnstile(turnstileSiteKey, loginUrl, { apiKey: this.captchaApiKey ?? undefined });
      const cookies = this._parseCookies(res.headers.get('set-cookie') || '');
      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      const form = $('form').first();
      const action = form.attr('action') || '';
      const formUrl = action.startsWith('http')
        ? action
        : new URL(action || loginUrl, loginUrl).href;
      const turnstileFormData: Record<string, string> = {};
      form.find('input[name]').each((_, el) => {
        const name = $(el).attr('name');
        const value = $(el).attr('value') || '';
        if (name) turnstileFormData[name] = value;
      });
      turnstileFormData['cf-turnstile-response'] = token;
      const passRes = await fetch(formUrl, {
        method: 'POST',
        redirect: 'follow' as const,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
          Referer: loginUrl,
        },
        body: new URLSearchParams(turnstileFormData),
      });
      const passHtml = await passRes.text();
      const $pass = cheerio.load(passHtml);
      const passTitle = ($pass('title').text() || '').trim();
      if (passTitle.includes('Just a moment')) {
        throw new Error(
          'VFS Global is behind Cloudflare. The challenge could not be passed with the current request. ' +
            'Use test-vfs-captcha --solve to debug, or run login in a headless browser and reuse cookies.'
        );
      }
      const mergedCookies = {
        ...cookies,
        ...this._parseCookies(passRes.headers.get('set-cookie') || ''),
      };
      const finalCookieAfterCf = Object.entries(mergedCookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      res = await fetch(loginUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: finalCookieAfterCf,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow' as const,
      });
      html = await res.text();
      $ = cheerio.load(html);
    } else if (isCloudflare) {
      logger.info('VFS Global: Cloudflare without sitekey, falling back to browser flow...');
      return this._loginWithBrowser();
    }

    const form = $('form[action*="login"], form#loginForm, form').first();
    const action = form.attr('action') || '';
    const method = (form.attr('method') || 'post').toLowerCase();
    const formUrl = action.startsWith('http') ? action : new URL(action, loginUrl).href;

    const formData: Record<string, string> = {};
    form.find('input[name]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      const type = ($(el).attr('type') || '').toLowerCase();
      if (name && type !== 'submit' && type !== 'image') {
        formData[name] = value;
      }
    });

    const emailKey = form
      .find('input[type="email"], input[name*="mail"], input[name*="user"]')
      .attr('name');
    const passwordKey = form.find('input[type="password"]').attr('name');
    if (emailKey) formData[emailKey] = this.email;
    else formData['email'] = formData['Email'] = formData['username'] = this.email;
    if (passwordKey) formData[passwordKey] = this.password;
    else formData['password'] = formData['Password'] = this.password;

    const recaptchaSiteKey =
      $('[data-sitekey]').attr('data-sitekey') ?? $('div.g-recaptcha').attr('data-sitekey');
    const captchaImg = form.find('img.captcha, img[src*="captcha"], #captcha-image');

    if (recaptchaSiteKey) {
      logger.info('VFS Global: Solving reCAPTCHA...');
      const token = this.captchaSolver
        ? await this.captchaSolver({
            type: 'recaptcha',
            siteKey: recaptchaSiteKey,
            pageUrl: loginUrl,
          })
        : await solveRecaptchaV2(recaptchaSiteKey, loginUrl, { apiKey: this.captchaApiKey ?? undefined });
      formData['g-recaptcha-response'] = token;
    } else if (captchaImg.length) {
      const src = captchaImg.attr('src') || '';
      logger.info('VFS Global: Solving image captcha...');
      let imageBase64 = src;
      if (src.startsWith('http')) {
        const imgRes = await fetch(src, {
          headers: { Cookie: res.headers.get('set-cookie') || '' },
        });
        const buf = await (imgRes as unknown as { buffer: () => Promise<Buffer> }).buffer();
        imageBase64 = buf.toString('base64');
      } else if (src.startsWith('data:')) {
        imageBase64 = src;
      }
      const solution = this.captchaSolver
        ? await this.captchaSolver({ type: 'image', imageBase64 })
        : await solveImageCaptcha(imageBase64, { apiKey: this.captchaApiKey ?? undefined });
      const captchaInputName =
        form.find('input[name*="captcha"], input[name*="captcha_response"]').attr('name') ?? 'captcha';
      formData[captchaInputName] = solution;
    }

    const cookies = this._parseCookies(res.headers.get('set-cookie') || '');
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const postRes = await fetch(formUrl, {
      method: (method === 'get' ? 'GET' : 'POST') as 'GET' | 'POST',
      redirect: 'manual' as const,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Referer: loginUrl,
      },
      body: method === 'get' ? undefined : new URLSearchParams(formData),
    });

    const setCookie = postRes.headers.get('set-cookie') || '';
    const mergedCookies = { ...cookies, ...this._parseCookies(setCookie) };
    const finalCookie = Object.entries(mergedCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const body = await postRes.text();
    if (
      postRes.status >= 400 ||
      body.toLowerCase().includes('invalid') ||
      body.toLowerCase().includes('captcha')
    ) {
      throw new Error('VFS Global login failed. Check credentials or captcha.');
    }

    logger.info('VFS Global: Login successful');
    return {
      Cookie: finalCookie,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: this.baseUri,
      Accept: 'application/json, text/html, */*',
    };
  }

  async checkAvailableDate(
    headers: Record<string, string>,
    _scheduleId: string,
    _facilityId: string | number
  ): Promise<string[]> {
    if (this._browserSession) {
      const params = {
        visa_center: this.vfsCentre || 'Visa Application Centre',
        visa_category: this.vfsCategory || 'Visit',
        visa_sub_category: this.vfsSubcategory || 'Standard',
      };
      return vfsGetAvailableDatesFromPage(this._browserSession.page, params);
    }
    const url = `${this.baseUri}/api/availability/dates`;
    try {
      const res = await fetch(url, {
        headers: {
          ...headers,
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as
        | Array<string | { date?: string }>
        | { dates?: string[]; availableDates?: string[]; slots?: string[] };
      const dates = Array.isArray(data)
        ? data
        : data.dates ?? data.availableDates ?? data.slots ?? [];
      return dates
        .map((d) => (typeof d === 'string' ? d.slice(0, 10) : (d as { date?: string }).date ?? d))
        .filter(Boolean) as string[];
    } catch (e) {
      logger.warn(`VFS checkAvailableDate not implemented or request failed: ${formatErrorForLog(e)}`);
      return [];
    }
  }

  async checkAvailableTime(
    _headers: Record<string, string>,
    _scheduleId: string,
    _facilityId: string | number,
    date: string
  ): Promise<string | null> {
    if (this._browserSession) {
      return vfsGetAvailableTimeFromPage(this._browserSession.page, date);
    }
    const url = `${this.baseUri}/api/availability/times`;
    try {
      const res = await fetch(`${url}?date=${date}`, {
        headers: { ..._headers, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as string[] | { times?: string[]; slots?: string[] };
      const times = Array.isArray(data) ? data : data.times ?? data.slots ?? [];
      return times[0] ? (typeof times[0] === 'string' ? times[0] : (times[0] as { time?: string }).time ?? times[0]) : null;
    } catch (e) {
      logger.warn(`VFS checkAvailableTime not implemented or failed: ${formatErrorForLog(e)}`);
      return null;
    }
  }

  async book(
    _headers: Record<string, string>,
    _scheduleId: string,
    _facilityId: string | number,
    date: string,
    time: string
  ): Promise<void> {
    if (this._browserSession) {
      return vfsBookFromPage(this._browserSession.page, date, time);
    }
    throw new Error(
      'VFS Global book() not yet implemented for fetch mode. Use browser flow (useBrowser or Cloudflare fallback).'
    );
  }

  _parseCookies(setCookie: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!setCookie) return out;
    setCookie.split(',').forEach((part) => {
      const [nameVal] = part.split(';').map((s) => s.trim());
      const [name, value] = (nameVal || '').split('=').map((s) => s?.trim() ?? '');
      if (name && value) out[name] = value;
    });
    return out;
  }
}
