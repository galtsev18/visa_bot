import { logger } from './logger';
import { formatErrorForLog } from './utils';

const TURNSTILE_INJECT_SCRIPT = `
(function() {
  if (window.__cfInjected) return;
  window.__cfInjected = true;
  console.clear = function() { console.log('Console was cleared'); };
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

export interface PassCloudflareOptions {
  timeout?: number;
  headless?: boolean;
  screenshotPath?: string;
  use2Captcha?: boolean;
  captchaApiKey?: string;
}

export interface PassCloudflareResult {
  html: string;
  url: string;
  cookies: Array<{ name: string; value: string }>;
  title: string;
  screenshotPath?: string;
  stealthUsed?: boolean;
}

/**
 * Pass Cloudflare "Just a moment..." challenge using a headless browser.
 * Optionally use 2Captcha to solve the Turnstile challenge (intercept params, get token, call callback).
 */
export async function passCloudflareWithBrowser(
  url: string,
  options: PassCloudflareOptions = {}
): Promise<PassCloudflareResult> {
  const timeout = options.timeout ?? 30000;
  const headless = options.headless !== false;
  const use2Captcha = options.use2Captcha === true;

  let puppeteer: { default?: unknown; launch: (opts: unknown) => Promise<unknown> };
  let useStealth = false;
  try {
    const extra = await import('puppeteer-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    (extra as { default: { use: (p: unknown) => void } }).default.use(StealthPlugin());
    puppeteer = extra.default as typeof puppeteer;
    useStealth = true;
  } catch (err) {
    logger.warn(`puppeteer-extra not available, using plain puppeteer: ${formatErrorForLog(err)}`);
    try {
      puppeteer = (await import('puppeteer')) as typeof puppeteer;
    } catch (err2) {
      logger.warn(`puppeteer import failed: ${formatErrorForLog(err2)}`);
      throw new Error(
        'Puppeteer is not installed. Install with: npm install puppeteer. ' +
          'For better Cloudflare pass rate on server: npm install puppeteer-extra puppeteer-extra-plugin-stealth'
      );
    }
  }

  const p = puppeteer;
  const browser = await (p.launch as (opts?: object) => Promise<{ newPage: () => Promise<unknown>; close: () => Promise<void> }>)({
    headless: headless ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1280,720',
    ],
  });

  try {
    const page = (await browser.newPage()) as {
      setUserAgent: (u: string) => Promise<void>;
      setViewport: (v: { width: number; height: number }) => Promise<void>;
      setExtraHTTPHeaders: (h: Record<string, string>) => Promise<void>;
      evaluateOnNewDocument: (s: string) => Promise<void>;
      on: (ev: string, fn: (msg: { text: () => string }) => Promise<void>) => void;
      goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<void>;
      waitForNavigation: (opts: { waitUntil: string; timeout: number }) => Promise<void>;
      title: () => Promise<string>;
      content: () => Promise<string>;
      url: string;
      cookies: () => Promise<Array<{ name: string; value: string }>>;
      screenshot: (opts: { path: string; type: string }) => Promise<void>;
      evaluate: (fn: (t: string) => void, arg: string) => Promise<void>;
    };

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    if (use2Captcha) {
      const { solveTurnstileChallengePage } = await import('./captcha');
      let captchaResolve: () => void;
      let captchaReject: (err: unknown) => void;
      const captchaDone = new Promise<void>((res, rej) => {
        captchaResolve = res;
        captchaReject = rej;
      });

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
          const { token } = await solveTurnstileChallengePage(params, {
            apiKey: options.captchaApiKey,
          });
          await page.evaluate((t) => {
            if (typeof (window as unknown as { cfCallback?: (t: string) => void }).cfCallback === 'function') {
              (window as unknown as { cfCallback: (t: string) => void }).cfCallback(t);
            }
          }, token);
          captchaResolve!();
        } catch (err) {
          logger.error(`2Captcha Turnstile solve/apply failed: ${formatErrorForLog(err)}`);
          captchaReject!(err);
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout });

      try {
        await Promise.race([
          captchaDone,
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('NO_PARAMS')), 15000)
          ),
        ]);
      } catch (e) {
        if ((e as Error)?.message !== 'NO_PARAMS') throw e;
        // No Turnstile params intercepted in time; continue with current page
      }

      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 });
      } catch (err) {
        logger.error(`Wait for navigation failed: ${formatErrorForLog(err)}`);
        // navigation may have already happened or timed out
      }
    } else {
      if (useStealth) {
        await new Promise((r) => setTimeout(r, 1500));
      }
      await page.goto(url, { waitUntil: 'networkidle2', timeout });

      const waitMax = Math.min(60000, timeout + 30000);
      const start = Date.now();
      while (Date.now() - start < waitMax) {
        const title = await page.title();
        if (!title.includes('Just a moment')) break;
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    const finalTitle = await page.title();
    const html = await page.content();
    const finalUrl = page.url;
    const cookies = await page.cookies();

    let screenshotPath: string | null = null;
    if (options.screenshotPath) {
      try {
        await page.screenshot({ path: options.screenshotPath, type: 'png' });
        screenshotPath = options.screenshotPath;
      } catch (err) {
        logger.error(`Screenshot failed: ${formatErrorForLog(err)}`);
      }
    }

    return {
      html,
      url: finalUrl,
      cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
      title: finalTitle,
      stealthUsed: useStealth,
      screenshotPath: screenshotPath ?? undefined,
    };
  } finally {
    await browser.close();
  }
}
