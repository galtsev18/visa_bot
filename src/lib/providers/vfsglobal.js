import fetch from 'node-fetch';
import cheerio from 'cheerio';
import { log } from '../utils.js';
import { solveImageCaptcha, solveRecaptchaV2, solveTurnstile } from '../captcha.js';

const VFS_BASE_URI = 'https://visa.vfsglobal.com';

/**
 * VFS Global visa appointment client (visa.vfsglobal.com).
 * Different schema and procedure from AIS; login has captcha.
 *
 * Compatible interface with VisaHttpClient for use with Bot:
 * - constructor(countryCode, email, password) or (config with email, password, countryCode/locale)
 * - login() -> session headers/cookies
 * - checkAvailableDate(headers, scheduleId, facilityId) -> date[]
 * - checkAvailableTime(headers, scheduleId, facilityId, date) -> time | null
 * - book(headers, scheduleId, facilityId, date, time)
 *
 * Optional: pass captchaSolver in options to override 2Captcha (e.g. manual solver).
 * @param { (params: { type: 'image'|'recaptcha', imageBase64?: string, siteKey?: string, pageUrl?: string }) => Promise<string> } [captchaSolver]
 */
export class VfsGlobalClient {
  constructor(countryCodeOrConfig, email, password) {
    if (typeof countryCodeOrConfig === 'object') {
      this.locale = countryCodeOrConfig.locale || countryCodeOrConfig.countryCode || 'rus/en/fra';
      this.email = countryCodeOrConfig.email;
      this.password = countryCodeOrConfig.password;
      this.captchaSolver = countryCodeOrConfig.captchaSolver || null;
      this.captchaApiKey = countryCodeOrConfig.captchaApiKey ?? null;
    } else {
      this.locale = countryCodeOrConfig || 'rus/en/fra';
      this.email = email;
      this.password = password;
      this.captchaSolver = null;
      this.captchaApiKey = null;
    }
    this.baseUri = `${VFS_BASE_URI}/${this.locale}`.replace(/\/+/g, '/');
  }

  /**
   * Login; handles captcha via 2Captcha or optional captchaSolver callback.
   * @returns {Promise<Record<string, string>>} session (headers with Cookie)
   */
  async login() {
    log('VFS Global: Loading login page...');
    const loginUrl = `${this.baseUri}/login`;
    let res = await fetch(loginUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    let html = await res.text();
    let $ = cheerio.load(html);
    const pageTitle = ($('title').text() || '').trim();
    const bodyText = ($('body').text() || '').toLowerCase();

    // Cloudflare challenge blocks access to the real login form
    const isCloudflare =
      pageTitle.includes('Just a moment') ||
      bodyText.includes('cloudflare') ||
      bodyText.includes('security verification');
    const turnstileSiteKey =
      $('.cf-turnstile[data-sitekey]').attr('data-sitekey') ||
      $('.cf-turnstile').attr('data-sitekey') ||
      (isCloudflare ? $('[data-sitekey]').first().attr('data-sitekey') : null);

    if (isCloudflare && turnstileSiteKey) {
      log('VFS Global: Cloudflare Turnstile challenge detected, solving...');
      const token = this.captchaSolver
        ? await this.captchaSolver({
            type: 'turnstile',
            siteKey: turnstileSiteKey,
            pageUrl: loginUrl,
          })
        : await solveTurnstile(turnstileSiteKey, loginUrl, { apiKey: this.captchaApiKey });
      const cookies = this._parseCookies(res.headers.get('set-cookie') || '');
      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      const form = $('form').first();
      const action = form.attr('action') || '';
      const formUrl = action.startsWith('http')
        ? action
        : new URL(action || loginUrl, loginUrl).href;
      const turnstileFormData = {};
      form.find('input[name]').each((_, el) => {
        const name = $(el).attr('name');
        const value = $(el).attr('value') || '';
        if (name) turnstileFormData[name] = value;
      });
      turnstileFormData['cf-turnstile-response'] = token;
      const passRes = await fetch(formUrl, {
        method: 'POST',
        redirect: 'follow',
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
      // Re-fetch login page with the cookies from passRes to get the real form
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
        redirect: 'follow',
      });
      html = await res.text();
      $ = cheerio.load(html);
    } else if (isCloudflare) {
      throw new Error(
        'VFS Global returned a Cloudflare challenge page ("Just a moment..."). ' +
          'No Turnstile sitekey was found; passing it usually requires a headless browser (e.g. Puppeteer). ' +
          'Run: node src/index.js test-vfs-captcha --solve'
      );
    }

    // Parse form: action, method, and all inputs (adapt selectors to real VFS page)
    const form = $('form[action*="login"], form#loginForm, form').first();
    const action = form.attr('action') || '';
    const method = (form.attr('method') || 'post').toLowerCase();
    const formUrl = action.startsWith('http') ? action : new URL(action, loginUrl).href;

    const formData = {};
    form.find('input[name]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      const type = ($(el).attr('type') || '').toLowerCase();
      if (name && type !== 'submit' && type !== 'image') {
        formData[name] = value;
      }
    });

    // Add credentials - use keys that exist in form, or fallbacks
    const emailKey = form
      .find('input[type="email"], input[name*="mail"], input[name*="user"]')
      .attr('name');
    const passwordKey = form.find('input[type="password"]').attr('name');
    if (emailKey) formData[emailKey] = this.email;
    else formData['email'] = formData['Email'] = formData['username'] = this.email;
    if (passwordKey) formData[passwordKey] = this.password;
    else formData['password'] = formData['Password'] = this.password;

    // Detect and solve captcha
    const recaptchaSiteKey =
      $('[data-sitekey]').attr('data-sitekey') || $('div.g-recaptcha').attr('data-sitekey');
    const captchaImg = form.find('img.captcha, img[src*="captcha"], #captcha-image');

    if (recaptchaSiteKey) {
      log('VFS Global: Solving reCAPTCHA...');
      const token = this.captchaSolver
        ? await this.captchaSolver({
            type: 'recaptcha',
            siteKey: recaptchaSiteKey,
            pageUrl: loginUrl,
          })
        : await solveRecaptchaV2(recaptchaSiteKey, loginUrl, { apiKey: this.captchaApiKey });
      formData['g-recaptcha-response'] = token;
    } else if (captchaImg.length) {
      const src = captchaImg.attr('src') || '';
      log('VFS Global: Solving image captcha...');
      let imageBase64 = src;
      if (src.startsWith('http')) {
        const imgRes = await fetch(src, {
          headers: { Cookie: res.headers.get('set-cookie') || '' },
        });
        const buf = await imgRes.buffer();
        imageBase64 = buf.toString('base64');
      } else if (src.startsWith('data:')) {
        imageBase64 = src;
      }
      const solution = this.captchaSolver
        ? await this.captchaSolver({ type: 'image', imageBase64 })
        : await solveImageCaptcha(imageBase64, { apiKey: this.captchaApiKey });
      const captchaInputName =
        form.find('input[name*="captcha"], input[name*="captcha_response"]').attr('name') ||
        'captcha';
      formData[captchaInputName] = solution;
    }

    const cookies = this._parseCookies(res.headers.get('set-cookie') || '');
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    const postRes = await fetch(formUrl, {
      method: method === 'get' ? 'GET' : 'POST',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Referer: loginUrl,
      },
      body: method === 'get' ? null : new URLSearchParams(formData),
    });

    const setCookie = postRes.headers.get('set-cookie') || '';
    const mergedCookies = { ...cookies, ...this._parseCookies(setCookie) };
    const finalCookie = Object.entries(mergedCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    // Check for login failure (e.g. wrong password or captcha)
    const body = await postRes.text();
    if (
      postRes.status >= 400 ||
      body.toLowerCase().includes('invalid') ||
      body.toLowerCase().includes('captcha')
    ) {
      throw new Error('VFS Global login failed. Check credentials or captcha.');
    }

    log('VFS Global: Login successful');
    return {
      Cookie: finalCookie,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: this.baseUri,
      Accept: 'application/json, text/html, */*',
    };
  }

  /**
   * Get available appointment dates. VFS API/schema must be filled in from real site.
   * @param {Record<string, string>} headers - session from login()
   * @param {string} scheduleId - application/schedule identifier (VFS may use different name)
   * @param {string|number} facilityId - center/location id
   * @returns {Promise<string[]>} YYYY-MM-DD dates
   */
  async checkAvailableDate(headers, _scheduleId, _facilityId) {
    // TODO: Replace with real VFS endpoint and response mapping
    // Example: GET/POST to something like /api/appointments/dates?centerId=...&category=...
    const url = `${this.baseUri}/api/availability/dates`; // placeholder
    try {
      const res = await fetch(url, {
        headers: {
          ...headers,
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!res.ok) return [];
      const data = await res.json();
      // Map VFS response to date strings, e.g. data.dates or data.availableDates
      const dates = Array.isArray(data)
        ? data
        : data.dates || data.availableDates || data.slots || [];
      return dates
        .map((d) => (typeof d === 'string' ? d.slice(0, 10) : d.date || d))
        .filter(Boolean);
    } catch (e) {
      log(`VFS checkAvailableDate not implemented or request failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Get first available time for a date. VFS schema required.
   */
  async checkAvailableTime(_headers, _scheduleId, _facilityId, date) {
    const url = `${this.baseUri}/api/availability/times`; // placeholder
    try {
      const res = await fetch(`${url}?date=${date}`, {
        headers: { ..._headers, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const times = Array.isArray(data) ? data : data.times || data.slots || [];
      return times[0] ? times[0].time || times[0] : null;
    } catch (e) {
      log(`VFS checkAvailableTime not implemented or failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Submit booking. VFS schema required.
   */
  async book(_headers, _scheduleId, _facilityId, _date, _time) {
    // TODO: POST to real VFS booking endpoint with date, time, facility
    throw new Error(
      'VFS Global book() not yet implemented. Implement after mapping real VFS booking API.'
    );
  }

  _parseCookies(setCookie) {
    const out = {};
    if (!setCookie) return out;
    setCookie.split(',').forEach((part) => {
      const [nameVal] = part.split(';').map((s) => s.trim());
      const [name, value] = (nameVal || '').split('=').map((s) => s.trim());
      if (name && value) out[name] = value;
    });
    return out;
  }
}
