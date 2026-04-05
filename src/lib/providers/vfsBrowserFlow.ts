/**
 * VFS Global full flow in headless browser (Puppeteer).
 * Used when fetch-based login hits Cloudflare or when useBrowser is set.
 * Sequence: pre_login (cookies) → login (email/password + captcha) → Start New Booking →
 * select centre/category/subcategory → get dates (div.alert or fc-daygrid) → get time → book.
 * AIS-specific logic stays in lib/client.ts and lib/providers/ais.ts only.
 */

import { logger } from '../logger';
import { formatErrorForLog } from '../utils';
import { solveTurnstileChallengePage } from '../captcha';
import { proxyServerArg } from '../geonixProxy';

const VFS_BASE_URI = 'https://visa.vfsglobal.com';

const TURNSTILE_INJECT_SCRIPT = `
(function() {
  if (window.__cfInjected) return;
  window.__cfInjected = true;
  var i = setInterval(function() {
    if (window.turnstile) {
      clearInterval(i);
      window.turnstile.render = function(a, b) {
        var params = {
          sitekey: b.sitekey,
          pageurl: window.location.href,
          data: b.cData,
          pagedata: b.chlPageData,
          action: b.action,
          userAgent: navigator.userAgent
        };
        console.log('intercepted-params:' + JSON.stringify(params));
        window.cfCallback = b.callback;
        return '';
      };
    }
  }, 50);
})();
`;

/** Proxy for VFS browser (cabinet often only from country-specific IP, e.g. Russia). */
export interface VfsProxyConfig {
  server: string;
  username: string;
  password: string;
}

export interface VfsBrowserLoginOptions {
  locale: string;
  email: string;
  password: string;
  captchaApiKey?: string;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
  headless?: boolean;
  timeout?: number;
  /** Wait time for login form to appear (after Cloudflare); default 15000 */
  formTimeout?: number;
  /** Proxy (e.g. from Geonix for Russian IP). Auth via page.authenticate(). */
  proxy?: VfsProxyConfig | null;
}

export interface VfsBrowserSession {
  page: unknown;
  browser: unknown;
}

export interface VfsAppointmentParams {
  visa_center: string;
  visa_category: string;
  visa_sub_category: string;
}

/**
 * Launch browser, open VFS login page, pass Cloudflare if needed, do pre_login (cookie consent),
 * fill email/password, solve captcha, submit, wait for "Start New Booking".
 * Returns { page, browser }; caller must close browser when done.
 */
export async function vfsBrowserLogin(
  options: VfsBrowserLoginOptions
): Promise<VfsBrowserSession> {
  const timeout = options.timeout ?? 60000;
  const headless = options.headless !== false;
  const loginUrl = `${VFS_BASE_URI}/${options.locale.replace(/^\/+|\/+$/g, '')}/login`;
  logger.info(`VFS browser: opening login URL: ${loginUrl}`);
  if (!options.captchaApiKey?.trim()) {
    logger.warn('VFS browser: CAPTCHA_2CAPTCHA_API_KEY not set (Settings sheet or .env). Cloudflare Turnstile will not be solved automatically.');
  }

  type BrowserLike = { newPage(): Promise<PageLike>; close(): Promise<void> };
  type PageLike = {
    setUserAgent(u: string): Promise<void>;
    setViewport(v: { width: number; height: number }): Promise<void>;
    goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
    waitForSelector(sel: string, opts?: { timeout?: number }): Promise<unknown>;
    click(sel: string, opts?: { timeout?: number }): Promise<void>;
    type(sel: string, text: string, opts?: { delay?: number }): Promise<void>;
    evaluateOnNewDocument(s: string): Promise<void>;
    on(ev: string, fn: (msg: { text: () => string }) => Promise<void>): void;
    evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
    content(): Promise<string>;
    url: string;
    title(): Promise<string>;
    $$(sel: string): Promise<Array<{ click: () => Promise<void> }>>;
  };

  let puppeteer: { launch: (opts: object) => Promise<BrowserLike> };
  try {
    const extra = await import('puppeteer-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    (extra as { default: { use: (p: unknown) => void } }).default.use(StealthPlugin());
    puppeteer = extra.default as unknown as { launch: (opts: object) => Promise<BrowserLike> };
  } catch {
    puppeteer = (await import('puppeteer')) as unknown as {
      launch: (opts: object) => Promise<BrowserLike>;
    };
  }

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,720',
  ];
  if (options.proxy?.server) {
    launchArgs.push(proxyServerArg(options.proxy.server));
    logger.info(`VFS browser: using proxy ${options.proxy.server}`);
  }

  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: launchArgs,
  });

  const page = (await browser.newPage()) as PageLike & {
    authenticate?: (opts: { username: string; password: string }) => Promise<void>;
  };
  if (options.proxy?.server && options.proxy.username && page.authenticate) {
    await page.authenticate({
      username: options.proxy.username,
      password: options.proxy.password,
    });
  }
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 720 });

  let captchaResolve: () => void;
  let captchaReject: (err: unknown) => void;
  /** Set when Turnstile/2Captcha fails (for clearer errors vs form timeout). */
  let captchaFailure: unknown = undefined;
  const captchaDone = new Promise<void>((res, rej) => {
    captchaResolve = res;
    captchaReject = (err: unknown) => {
      captchaFailure = err;
      rej(err);
    };
  });
  // If Turnstile fails before Promise.race below, without this Node reports unhandledRejection → process.exit(1) in index.ts.
  void captchaDone.catch(() => {});

  await page.evaluateOnNewDocument(TURNSTILE_INJECT_SCRIPT);
  page.on('console', async (msg) => {
    const text = msg.text();
    if (!text.includes('intercepted-params:')) return;
    try {
      const json = text.replace('intercepted-params:', '').trim();
      const params = JSON.parse(json) as {
        sitekey: string;
        pageurl: string;
        data?: string;
        pagedata?: string;
        action?: string;
      };
      logger.info('VFS browser: Cloudflare Turnstile detected, solving...');
      const token = options.captchaSolver
        ? await options.captchaSolver({
            type: 'turnstile',
            siteKey: params.sitekey,
            pageUrl: params.pageurl,
          })
        : (
          await solveTurnstileChallengePage(
            {
              sitekey: params.sitekey,
              pageurl: params.pageurl,
              data: params.data,
              pagedata: params.pagedata,
              action: params.action,
            },
            { apiKey: options.captchaApiKey }
          )
        ).token;
      await page.evaluate((t) => {
        const w = window as unknown as { cfCallback?: (t: string) => void };
        if (typeof w.cfCallback === 'function') w.cfCallback(t);
      }, token);
      captchaResolve!();
    } catch (err) {
      logger.error(`VFS browser: 2Captcha Turnstile failed: ${formatErrorForLog(err)}`);
      captchaReject!(err);
    }
  });

  try {
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout });

    // Pre-login: cookie consent (Reject All) — ranjan pattern
    try {
      const clicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const reject = buttons.find(
          (b) =>
            /reject\s*all/i.test(b.textContent || '') || (b.getAttribute('aria-label') || '').toLowerCase().includes('reject')
        );
        if (reject) {
          (reject as HTMLButtonElement).click();
          return true;
        }
        return false;
      });
      if (clicked) await new Promise((r) => setTimeout(r, 500));
    } catch {
      // No cookie banner or different locale
    }

    // Give Cloudflare Turnstile time to render so our inject can hook it (if present)
    await new Promise((r) => setTimeout(r, 3000));

    // Wait for login form (after Cloudflare may have been solved); give time for Turnstile + redirect
    const emailSelector =
      '#mat-input-0, input[name="email"], input[type="email"], input[name="Email"]';
    const passwordSelector =
      '#mat-input-1, input[name="password"], input[type="password"], input[name="Password"]';
    const formTimeout = options.formTimeout ?? 60000;
    try {
      await page.waitForSelector(`${emailSelector}, ${passwordSelector}`, { timeout: formTimeout });
    } catch (formErr) {
      if (captchaFailure !== undefined) {
        throw captchaFailure instanceof Error
          ? captchaFailure
          : new Error(String(captchaFailure));
      }
      try {
        const { writeFile, mkdir } = await import('fs/promises');
        const { join } = await import('path');
        const dir = join(process.cwd(), '.tmp');
        await mkdir(dir, { recursive: true });
        const path = join(dir, `vfs-login-timeout-${Date.now()}.png`);
        await (page as unknown as { screenshot: (opts: { path: string }) => Promise<void> }).screenshot({ path });
        logger.warn(`VFS login form not found within ${formTimeout}ms; screenshot saved to ${path}`);
      } catch {
        // ignore screenshot errors
      }
      throw formErr;
    }

    if (captchaFailure !== undefined) {
      throw captchaFailure instanceof Error
        ? captchaFailure
        : new Error(String(captchaFailure));
    }

    await page.type(emailSelector, options.email, { delay: 50 });
    await page.type(passwordSelector, options.password, { delay: 50 });

    // Click Sign In — ranjan: get_by_role("button", name="Sign In")
    const signInClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      const signIn = buttons.find((b) => /sign\s*in/i.test(b.textContent || (b as HTMLInputElement).value || ''));
      if (signIn) {
        (signIn as HTMLButtonElement).click();
        return true;
      }
      return false;
    });
    if (!signInClicked) await page.click('button[type="submit"], input[type="submit"]', { timeout: 5000 });

    try {
      await Promise.race([
        captchaDone,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('NO_CAPTCHA_PARAMS')), 12000)),
      ]);
    } catch (e) {
      if ((e as Error)?.message !== 'NO_CAPTCHA_PARAMS') throw e;
    }

    await new Promise((r) => setTimeout(r, 2000));

    // Wait for post-login: "Start New Booking" button
    await page.waitForSelector('button, a, [role="button"]', { timeout: 25000 });
    const hasStartNewBooking = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((e) =>
        /start\s*new\s*booking/i.test(e.textContent || '')
      );
      return !!el;
    });
    if (!hasStartNewBooking) {
      throw new Error('VFS: "Start New Booking" not found after login. Check credentials or captcha.');
    }

    logger.info('VFS browser: Login successful, Start New Booking visible');
    return { page, browser };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * On a logged-in page, click "Start New Booking", select visa centre, category, subcategory,
 * then parse available dates from div.alert or calendar (fc-daygrid-event).
 */
/** Page-like interface for browser flow (Puppeteer page). */
export type VfsPageLike = {
  click(sel: string, opts?: { timeout?: number }): Promise<void>;
  waitForSelector(sel: string, opts?: { timeout?: number }): Promise<unknown>;
  evaluate<T, A = unknown>(fn: (arg: A) => T, arg?: A): Promise<T>;
  content(): Promise<string>;
  $$(sel: string): Promise<Array<{ click: () => Promise<void> }>>;
};

export async function vfsGetAvailableDatesFromPage(
  page: unknown,
  params: VfsAppointmentParams
): Promise<string[]> {
  const p = page as VfsPageLike;

  const startClicked = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((e) =>
      /start\s*new\s*booking/i.test(e.textContent || '')
    );
    if (el) {
      (el as HTMLElement).click();
      return true;
    }
    return false;
  });
  if (!startClicked) await p.waitForSelector('mat-form-field, div.alert, .fc-daygrid', { timeout: 15000 });

  await new Promise((r) => setTimeout(r, 1500));

  // mat-form-field dropdowns: first = visa centre, second = category, third = subcategory (ranjan DE)
  const dropdowns = await p.$$('mat-form-field');
  if (dropdowns.length >= 3) {
    const selectOption = async (dropdownIndex: number, optionText: string): Promise<void> => {
      await dropdowns[dropdownIndex].click();
      await new Promise((r) => setTimeout(r, 500));
      await p.evaluate((text: string) => {
        const options = Array.from(document.querySelectorAll('mat-option'));
        const opt = options.find((o) => (o.textContent || '').trim().includes(text));
        if (opt) (opt as HTMLElement).click();
      }, optionText);
      await new Promise((r) => setTimeout(r, 300));
    };
    await selectOption(0, params.visa_center);
    await selectOption(1, params.visa_category);
    await selectOption(2, params.visa_sub_category);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // 1) div.alert (ranjan DE) — dates in alert text
  const datesFromAlerts = (await p.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll('div.alert'));
    const out: string[] = [];
    for (const el of alerts) {
      const text = el.textContent || '';
      const match =
        text.match(/(\d{4})-(\d{2})-(\d{2})/) ||
        text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/) ||
        text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
      if (match) {
        if (match[0].includes('-') && match[1]!.length === 4) {
          out.push(match[0]);
        } else if (match[0].includes('/') || match[0].includes('-')) {
          const [, d, m, y] = match;
          out.push(`${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`);
        } else {
          const [, d, , y] = match;
          const months: Record<string, string> = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
          };
          const m = months[(match[2] as string).toLowerCase().slice(0, 3)] || '01';
          out.push(`${y}-${m}-${d!.padStart(2, '0')}`);
        }
      }
    }
    return out;
  })) as string[];

  if (datesFromAlerts.length > 0) return [...new Set(datesFromAlerts)].sort();

  // 2) Calendar: fc-daygrid-event (doxoz / minhalawais)
  const calendarDates = (await p.evaluate(() => {
    const out: string[] = [];
    const events = document.querySelectorAll('.fc-daygrid-event[data-date], .fc-daygrid-day[data-date]');
    events.forEach((el) => {
      const dateStr = el.getAttribute('data-date');
      if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) out.push(dateStr);
    });
    if (out.length > 0) return out;
    const dayNumbers = document.querySelectorAll('.fc-daygrid-day-number');
    const titleEl = document.querySelector('.fc-toolbar-title');
    const monthYear = titleEl ? titleEl.textContent || '' : '';
    const myMatch = monthYear.match(/(\w+)\s+(\d{4})/);
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    };
    dayNumbers.forEach((el) => {
      const d = (el.textContent || '').trim();
      if (myMatch && d && /^\d{1,2}$/.test(d)) {
        const m = months[myMatch[1].toLowerCase()];
        if (m) out.push(`${myMatch[2]}-${m}-${d.padStart(2, '0')}`);
      }
    });
    return out;
  })) as string[];
  if (calendarDates.length > 0) return [...new Set(calendarDates)].sort();

  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Navigate FullCalendar until a cell with data-date exists (best-effort). */
async function ensureDateCellVisible(p: VfsPageLike, isoDate: string): Promise<void> {
  const cellPresent = () =>
    p.evaluate((d: string) => {
      return !!document.querySelector(`.fc-daygrid-day[data-date="${d}"]`);
    }, isoDate);

  if (await cellPresent()) return;

  for (let i = 0; i < 16; i++) {
    await p.evaluate(() => {
      const next = document.querySelector(
        '.fc-next-button, button.fc-next-button, .fc-icon-chevron-right'
      ) as HTMLElement | null;
      next?.click();
    });
    await sleep(450);
    if (await cellPresent()) return;
  }
  for (let i = 0; i < 16; i++) {
    await p.evaluate(() => {
      const prev = document.querySelector(
        '.fc-prev-button, button.fc-prev-button, .fc-icon-chevron-left'
      ) as HTMLElement | null;
      prev?.click();
    });
    await sleep(450);
    if (await cellPresent()) return;
  }
}

async function clickCalendarDate(p: VfsPageLike, isoDate: string): Promise<boolean> {
  const hasCalendar = await p.evaluate(
    () => !!document.querySelector('.fc-daygrid, .fc-daygrid-day[data-date]')
  );
  if (!hasCalendar) return false;

  await ensureDateCellVisible(p, isoDate);
  return p.evaluate((d: string) => {
    const cell =
      (document.querySelector(`.fc-daygrid-day[data-date="${d}"]`) as HTMLElement | null) ||
      (document.querySelector(`td[data-date="${d}"]`) as HTMLElement | null);
    if (!cell) return false;
    if (cell.classList.contains('fc-day-disabled')) return false;
    cell.click();
    return true;
  }, isoDate);
}

async function clickDateFallback(p: VfsPageLike, isoDate: string): Promise<boolean> {
  return p.evaluate((d: string) => {
    const [y, m, day] = d.split('-');
    const dmy = day && m && y ? `${day}.${m}.${y}` : '';
    const candidates = Array.from(
      document.querySelectorAll(
        'a, button, [role="button"], .fc-daygrid-event, mat-list-item, tr, td, .slot-item'
      )
    ) as HTMLElement[];
    for (const el of candidates) {
      const t = el.textContent || '';
      if (t.includes(d) || (dmy && t.includes(dmy))) {
        el.click();
        return true;
      }
    }
    return false;
  }, isoDate);
}

/** Select date on appointment UI (calendar or list). */
async function selectAppointmentDateOnPage(p: VfsPageLike, isoDate: string): Promise<boolean> {
  if (await clickCalendarDate(p, isoDate)) return true;
  return clickDateFallback(p, isoDate);
}

async function selectTimeSlot(p: VfsPageLike, time: string): Promise<boolean> {
  return p.evaluate((wanted: string) => {
    const matchText = (txt: string) => {
      const n = txt.replace(/\s+/g, ' ').trim().toLowerCase();
      const w = wanted.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!n || !w) return false;
      if (n === w) return true;
      const digits = (x: string) => x.replace(/[^\d:]/g, '');
      const dn = digits(n);
      const dw = digits(w);
      if (dn.length >= 3 && dn === dw) return true;
      return n.includes(w) || w.includes(n);
    };

    const selectors = [
      'mat-option',
      '.mat-mdc-option',
      '[role="option"]',
      '.fc-timegrid-event',
      '.fc-event',
      '.fc-list-event',
      '.time-slot',
      '[class*="time-slot"]',
      '[data-slot]',
      'button',
      'a',
      'li',
    ].join(', ');

    const nodes = Array.from(document.querySelectorAll(selectors)) as HTMLElement[];
    const scored = nodes.filter((el) => matchText(el.textContent || ''));
    if (scored.length === 0) return false;
    scored.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    scored[0].click();
    return true;
  }, time);
}

async function selectTimeSlotWithRetry(p: VfsPageLike, time: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    if (await selectTimeSlot(p, time)) return true;
    await sleep(500);
  }
  return false;
}

async function clickNextBookingStep(p: VfsPageLike): Promise<boolean> {
  return p.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], a.mat-mdc-button, .mat-mdc-button, .mdc-button'
      )
    ) as HTMLElement[];
    let best: { el: HTMLElement; score: number } | null = null;
    for (const el of nodes) {
      if ((el as HTMLButtonElement).disabled) continue;
      const txt = (
        el.textContent ||
        (el as HTMLInputElement).value ||
        el.getAttribute('aria-label') ||
        ''
      ).trim();
      if (!txt) continue;
      const lower = txt.toLowerCase();
      let score = 0;
      if (
        /^(confirm|submit|book|continue|next|proceed|pay|schedule)\b/i.test(txt) ||
        /^(подтверд|далее|продолж|записаться|отправить|оформить)/i.test(txt)
      )
        score = 100;
      else if (
        /confirm|book\s*appointment|submit|continue|next\s*step|proceed\s*to/i.test(lower) ||
        /подтверждени|запись\s*на|продолжить|далее/i.test(lower)
      )
        score = 60;
      else if (/^ok$|^yes$/i.test(txt)) score = 40;
      if (score > 0 && (!best || score > best.score)) best = { el, score };
    }
    if (!best) return false;
    best.el.click();
    return true;
  });
}

async function evaluateBookingOutcome(p: VfsPageLike): Promise<'success' | 'error' | 'unknown'> {
  return p.evaluate(() => {
    const body = document.body.innerText.toLowerCase();
    const href = window.location.href.toLowerCase();

    if (
      /appointment\s*(has\s*been)?\s*confirmed|booking\s*confirmed|successfully\s*booked|your\s*reference|confirmation\s*number|booking\s*reference/i.test(
        body
      ) ||
      /подтвержден|успешно\s*записан|запись\s*оформлен|номер\s*заявк/i.test(body)
    )
      return 'success';
    if (
      /(\berror\b|failed|unavailable|sold out|session\s*expired|something\s*went\s*wrong|unable\s*to\s*book)/i.test(
        body
      ) ||
      /ошибк|не\s*удалось|недоступн|истекла\s*сессия/i.test(body)
    )
      return 'error';
    if (href.includes('confirm') || href.includes('success') || href.includes('appointment-conf'))
      return 'success';
    const snack = document.querySelector(
      'mat-snack-bar-container, .mat-mdc-snack-bar-container, simple-snack-bar'
    );
    const st = (snack?.textContent || '').toLowerCase();
    if (st && /error|fail/i.test(st)) return 'error';
    return 'unknown';
  });
}

async function runSubmitLoop(p: VfsPageLike): Promise<void> {
  if ((await evaluateBookingOutcome(p)) === 'success') return;

  for (let i = 0; i < 10; i++) {
    const clicked = await clickNextBookingStep(p);
    if (!clicked) break;
    await sleep(1200);
    const after = await evaluateBookingOutcome(p);
    if (after === 'success') return;
    if (after === 'error') throw new Error('VFS book: the site reported an error after submit');
  }
}

/**
 * After dates are shown, get first available time for the given date.
 * Clicks the day on FullCalendar when present so slot lists load (Angular/VFS).
 */
export async function vfsGetAvailableTimeFromPage(page: unknown, date: string): Promise<string | null> {
  const p = page as VfsPageLike;

  const hasCalendar = await p.evaluate(
    () => !!document.querySelector('.fc-daygrid, .fc-daygrid-day[data-date]')
  );
  if (hasCalendar) {
    const ok = await selectAppointmentDateOnPage(p, date);
    if (!ok) {
      logger.warn(
        `VFS: could not click calendar day ${date} before reading time; trying to read slots anyway`
      );
    }
    await sleep(700);
  }

  const timeFromPage = await p.evaluate(() => {
    const pickFromText = (raw: string | null | undefined): string | null => {
      const t = (raw || '').trim();
      if (!t) return null;
      const m = t.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?\b/i);
      return m ? m[0].trim() : null;
    };

    const trySelectors = [
      'input[name*="time"]',
      '[data-time]',
      '.fc-event-time',
      '.fc-timegrid-event',
      '.time-slot',
      'mat-option',
      '.mat-mdc-option',
      '[role="option"]',
    ];
    for (const sel of trySelectors) {
      const el = document.querySelector(sel) as HTMLElement | HTMLInputElement | null;
      if (!el) continue;
      const v = 'value' in el && el.value ? el.value : el.textContent;
      const picked = pickFromText(v || el.textContent);
      if (picked) return picked;
    }

    const listEls = Array.from(
      document.querySelectorAll('mat-option, .mat-mdc-option, [role="option"], button, li')
    );
    for (const el of listEls) {
      const picked = pickFromText(el.textContent);
      if (picked) return picked;
    }

    const timeText = document.querySelector('.fc-event-time, .time-slot');
    return timeText ? (timeText.textContent || '').trim() : null;
  });

  if (timeFromPage) return timeFromPage;

  const fromList = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll('mat-option, [role="option"], button, li'));
    for (const el of items) {
      const t = (el.textContent || '').trim();
      if (/\d{1,2}:\d{2}/.test(t)) return t.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?/i)?.[0] || t;
    }
    return null;
  });
  return fromList || null;
}

/**
 * Submit booking: select date, time slot, then confirm (Angular / FullCalendar patterns).
 */
export async function vfsBookFromPage(page: unknown, date: string, time: string): Promise<void> {
  const p = page as VfsPageLike;
  logger.info(`VFS browser: submitting booking for ${date} ${time}`);

  const dateOk = await selectAppointmentDateOnPage(p, date);
  if (!dateOk) {
    throw new Error(
      `VFS book: could not select date ${date} (no matching calendar cell or list row)`
    );
  }
  await sleep(800);

  if (!(await selectTimeSlotWithRetry(p, time))) {
    throw new Error(
      `VFS book: could not find or click time slot matching "${time}". Is the slot list open?`
    );
  }

  await sleep(600);
  await runSubmitLoop(p);
  await sleep(1500);

  let outcome = await evaluateBookingOutcome(p);
  if (outcome === 'unknown') {
    await sleep(2000);
    outcome = await evaluateBookingOutcome(p);
  }

  if (outcome === 'success') {
    logger.info('VFS browser: booking confirmation detected');
    return;
  }
  if (outcome === 'error') {
    throw new Error('VFS book: submission failed or site showed an error');
  }

  throw new Error(
    'VFS book: could not verify success (no confirmation text/URL matched). Check the portal or extend vfsBrowserFlow.evaluateBookingOutcome.'
  );
}
