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

import { log, formatErrorForLog } from './utils.js';

/**
 * Pass Cloudflare "Just a moment..." challenge using a headless browser.
 * Optionally use 2Captcha to solve the Turnstile challenge (intercept params, get token, call callback).
 *
 * @param {string} url - Page URL (e.g. VFS login)
 * @param {{ timeout?: number, headless?: boolean, screenshotPath?: string, use2Captcha?: boolean, captchaApiKey?: string }} options
 * @returns {Promise<{ html: string, url: string, cookies: Array<{ name: string, value: string }>, title: string, screenshotPath?: string, stealthUsed?: boolean }>}
 */
export async function passCloudflareWithBrowser(url, options = {}) {
  const timeout = options.timeout ?? 30000;
  const headless = options.headless !== false;
  const use2Captcha = options.use2Captcha === true;

  let puppeteer;
  let useStealth = false;
  try {
    const extra = await import('puppeteer-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    extra.default.use(StealthPlugin());
    puppeteer = extra.default;
    useStealth = true;
  } catch (err) {
    log(`puppeteer-extra not available, using plain puppeteer: ${formatErrorForLog(err)}`);
    try {
      puppeteer = await import('puppeteer');
    } catch (err2) {
      log(`puppeteer import failed: ${formatErrorForLog(err2)}`);
      throw new Error(
        'Puppeteer is not installed. Install with: npm install puppeteer. ' +
          'For better Cloudflare pass rate on server: npm install puppeteer-extra puppeteer-extra-plugin-stealth'
      );
    }
  }

  const p = puppeteer.default || puppeteer;
  const browser = await p.launch({
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
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    if (use2Captcha) {
      const { solveTurnstileChallengePage } = await import('./captcha.js');
      let captchaResolve;
      let captchaReject;
      const captchaDone = new Promise((res, rej) => {
        captchaResolve = res;
        captchaReject = rej;
      });

      await page.evaluateOnNewDocument(TURNSTILE_INJECT_SCRIPT);

      page.on('console', async (msg) => {
        const text = msg.text();
        if (!text.includes('intercepted-params:')) return;
        try {
          const json = text.replace('intercepted-params:', '').trim();
          const params = JSON.parse(json);
          const { token } = await solveTurnstileChallengePage(params, {
            apiKey: options.captchaApiKey,
          });
          await page.evaluate((t) => {
            if (window.cfCallback) window.cfCallback(t);
          }, token);
          captchaResolve();
        } catch (err) {
          log(`2Captcha Turnstile solve/apply failed: ${formatErrorForLog(err)}`);
          captchaReject(err);
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout });

      try {
        await Promise.race([
          captchaDone,
          new Promise((_, rej) => setTimeout(() => rej(new Error('NO_PARAMS')), 15000)),
        ]);
      } catch (e) {
        if ((e?.message ?? '') !== 'NO_PARAMS') throw e;
        // No Turnstile params intercepted in time; continue with current page
      }

      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 });
      } catch (err) {
        log(`Wait for navigation failed: ${formatErrorForLog(err)}`);
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
    const finalUrl = page.url();
    const cookies = await page.cookies();

    let screenshotPath = null;
    if (options.screenshotPath) {
      try {
        await page.screenshot({ path: options.screenshotPath, type: 'png' });
        screenshotPath = options.screenshotPath;
      } catch (err) {
        log(`Screenshot failed: ${formatErrorForLog(err)}`);
      }
    }

    return {
      html,
      url: finalUrl,
      cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
      title: finalTitle,
      stealthUsed: useStealth,
      screenshotPath: screenshotPath || undefined,
    };
  } finally {
    await browser.close();
  }
}
