import cheerio from 'cheerio';
import { getConfig } from '../lib/config';
import {
  solveImageCaptcha,
  solveRecaptchaV2,
  solveTurnstile,
} from '../lib/captcha';
import { passCloudflareWithBrowser } from '../lib/browserCloudflare';
import { logger } from '../lib/logger';
import { formatErrorForLog } from '../lib/utils';

const VFS_LOGIN_URL = 'https://visa.vfsglobal.com/rus/en/fra/login';

export interface TestVfsCaptchaOptions {
  solve?: boolean;
  browser?: boolean;
  visible?: boolean;
  screenshot?: boolean | string;
  email?: string;
  password?: string;
}

export async function testVfsCaptchaCommand(
  options: TestVfsCaptchaOptions = {}
): Promise<void> {
  const config = getConfig();
  const captchaApiKey =
    config.captcha2CaptchaApiKey ?? process.env.CAPTCHA_2CAPTCHA_API_KEY ?? null;

  const doSolve = options.solve === true;
  const doLogin = !!(options.email && options.password);
  const useBrowser = options.browser === true;

  let html: string;
  let resUrl = VFS_LOGIN_URL;
  let cookiesFromBrowser: Array<{ name: string; value: string }> | null = null;
  let res: { headers: { get: (n: string) => string | null }; url: string; text: () => Promise<string> } | undefined;

  if (useBrowser) {
    const headless = options.visible !== true;
    if (headless) {
      logger.info('Opening VFS login page in headless browser (Puppeteer)...');
      logger.info('On a server (no display), Cloudflare often does not pass in headless mode.');
    } else {
      logger.info('Opening VFS login page in visible browser (Puppeteer)...');
    }
    try {
      const screenshotPath =
        options.screenshot === true ? 'vfs-page-screenshot.png' : (options.screenshot as string) ?? null;
      const use2Captcha = doSolve && !!captchaApiKey;
      if (doSolve && !captchaApiKey) {
        logger.info(
          '2Captcha API key not set (config or CAPTCHA_2CAPTCHA_API_KEY); Cloudflare challenge will not be solved via 2Captcha.'
        );
      }
      if (use2Captcha) {
        logger.info('Will try to solve Cloudflare Turnstile with 2Captcha after page load.');
      }
      const result = await passCloudflareWithBrowser(VFS_LOGIN_URL, {
        timeout: 30000,
        headless,
        screenshotPath: screenshotPath ?? undefined,
        use2Captcha: use2Captcha || undefined,
        captchaApiKey: captchaApiKey ?? undefined,
      });
      html = result.html;
      resUrl = result.url;
      cookiesFromBrowser = result.cookies;
      if (result.stealthUsed) {
        logger.info('Stealth plugin used (puppeteer-extra-plugin-stealth).');
      }
      if (result.screenshotPath) {
        console.log(`\nScreenshot saved: ${result.screenshotPath}`);
      }
      if ((result.title || '').includes('Just a moment')) {
        logger.info(`Cloudflare challenge did not complete in time. Page title: ${result.title}`);
      } else {
        logger.info(`Browser loaded. Page title: ${result.title}`);
      }
    } catch (err) {
      console.error('Browser failed:', formatErrorForLog(err));
      process.exit(1);
    }
  } else {
    logger.info('Fetching VFS login page: ' + VFS_LOGIN_URL);
    try {
      const fetchRes = await fetch(VFS_LOGIN_URL, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow' as const,
      });
      res = fetchRes as typeof res;
      html = await (fetchRes as { text: () => Promise<string> }).text();
      resUrl = (res as { url: string }).url;
    } catch (err) {
      console.error('Fetch failed:', formatErrorForLog(err));
      process.exit(1);
    }
  }

  function getCookieHeader(): string {
    if (cookiesFromBrowser && cookiesFromBrowser.length) {
      return cookiesFromBrowser.map((c) => `${c.name}=${c.value}`).join('; ');
    }
    const setCookie = res ? res.headers.get('set-cookie') || '' : '';
    return setCookie
      .split(',')
      .reduce<string[]>((acc, part) => {
        const [nameVal] = part.split(';').map((s) => s.trim());
        const [name, value] = (nameVal || '').split('=').map((s) => (s && s.trim()) ?? '');
        if (name && value) acc.push(`${name}=${value}`);
        return acc;
      }, [])
      .join('; ');
  }

  const $ = cheerio.load(html);
  const pageTitle = ($('title').text() || '').trim();
  const bodyText = ($('body').text() || '').toLowerCase();

  const isCloudflare =
    pageTitle.includes('Just a moment') ||
    bodyText.includes('cloudflare') ||
    bodyText.includes('security verification') ||
    bodyText.includes('verify you are human');

  const form = $('form[action*="login"], form#loginForm, form').first();
  const formAction = form.attr('action') || '';
  const formMethod = (form.attr('method') || 'post').toLowerCase();
  const formUrl = formAction.startsWith('http')
    ? formAction
    : formAction
      ? new URL(formAction, VFS_LOGIN_URL).href
      : VFS_LOGIN_URL;

  console.log('\n--- Form ---');
  console.log('Method:', formMethod);
  console.log('Action:', formUrl);
  console.log('Inputs:', form.find('input[name]').length);

  const turnstileEl = $('.cf-turnstile[data-sitekey], div.cf-turnstile [data-sitekey]').first();
  const turnstileSiteKey =
    turnstileEl.attr('data-sitekey') ??
    $('.cf-turnstile').attr('data-sitekey') ??
    (isCloudflare ? $('[data-sitekey]').first().attr('data-sitekey') : null);

  const recaptchaEl = $('[data-sitekey], div.g-recaptcha');
  const recaptchaSiteKey =
    !turnstileSiteKey &&
    (recaptchaEl.attr('data-sitekey') ?? recaptchaEl.find('[data-sitekey]').attr('data-sitekey'));
  const captchaImg = $('img.captcha, img[src*="captcha"], img[src*="Captcha"], #captcha-image');

  let captchaType: string | null = null;
  const captchaInfo: {
    siteKey?: string;
    pageUrl?: string;
    imageSrc?: string;
    solution?: string;
  } = {};

  if (isCloudflare) {
    console.log('\n--- Cloudflare challenge ---');
    console.log('Page title:', pageTitle);
    if (turnstileSiteKey) {
      captchaType = 'turnstile';
      captchaInfo.siteKey = turnstileSiteKey;
      captchaInfo.pageUrl = resUrl || VFS_LOGIN_URL;
      console.log('Captcha: Cloudflare Turnstile');
      console.log('Site key:', turnstileSiteKey);
    } else {
      console.log(
        'No Turnstile sitekey found in HTML (challenge may be JS-only). ' +
          'Passing it typically requires a headless browser (e.g. Puppeteer).'
      );
    }
  } else if (turnstileSiteKey) {
    captchaType = 'turnstile';
    captchaInfo.siteKey = turnstileSiteKey;
    captchaInfo.pageUrl = VFS_LOGIN_URL;
    console.log('\n--- Captcha: Cloudflare Turnstile ---');
    console.log('Site key:', turnstileSiteKey);
  } else if (recaptchaSiteKey) {
    captchaType = 'recaptcha';
    captchaInfo.siteKey = recaptchaSiteKey;
    captchaInfo.pageUrl = VFS_LOGIN_URL;
    console.log('\n--- Captcha: reCAPTCHA v2 ---');
    console.log('Site key:', recaptchaSiteKey);
  } else if (captchaImg.length) {
    captchaType = 'image';
    captchaInfo.imageSrc = captchaImg.attr('src') || '';
    console.log('\n--- Captcha: Image ---');
    console.log(
      'Image src (first 120 chars):',
      captchaInfo.imageSrc ? captchaInfo.imageSrc.substring(0, 120) + (captchaInfo.imageSrc.length > 120 ? '...' : '') : 'none'
    );
  } else {
    console.log('\n--- No captcha detected ---');
    console.log('Checked: Cloudflare, .cf-turnstile, [data-sitekey], .g-recaptcha, img.captcha');
    console.log('Page title:', pageTitle);
  }

  if (captchaType && doSolve) {
    console.log('\n--- Solving captcha ---');
    try {
      if (captchaType === 'turnstile' && captchaInfo.siteKey && captchaInfo.pageUrl) {
        const token = await solveTurnstile(captchaInfo.siteKey, captchaInfo.pageUrl, {
          apiKey: captchaApiKey ?? undefined,
        });
        console.log(
          'Turnstile token (first 80 chars):',
          token ? token.substring(0, 80) + '...' : ''
        );
        captchaInfo.solution = token;
      } else if (captchaType === 'recaptcha' && captchaInfo.siteKey && captchaInfo.pageUrl) {
        const token = await solveRecaptchaV2(captchaInfo.siteKey, captchaInfo.pageUrl, {
          apiKey: captchaApiKey ?? undefined,
        });
        console.log(
          'reCAPTCHA token (first 80 chars):',
          token ? token.substring(0, 80) + '...' : ''
        );
        captchaInfo.solution = token;
      } else if (captchaType === 'image') {
        let imageBase64 = captchaInfo.imageSrc || '';
        if (imageBase64.startsWith('http')) {
          const imgRes = await fetch(imageBase64, {
            headers: { Cookie: getCookieHeader() },
          });
          const buf = await (imgRes as { buffer: () => Promise<Buffer> }).buffer();
          imageBase64 = buf.toString('base64');
        } else if (imageBase64.startsWith('/')) {
          const imgUrl = new URL(imageBase64, VFS_LOGIN_URL).href;
          const imgRes = await fetch(imgUrl, { headers: { Cookie: getCookieHeader() } });
          const buf = await (imgRes as { buffer: () => Promise<Buffer> }).buffer();
          imageBase64 = buf.toString('base64');
        }
        const solution = await solveImageCaptcha(imageBase64, {
          apiKey: captchaApiKey ?? undefined,
        });
        console.log('Image captcha solution:', solution);
        captchaInfo.solution = solution;
      }
    } catch (err) {
      console.error('Solve failed:', formatErrorForLog(err));
      if (!captchaApiKey) {
        console.error('Set CAPTCHA_2CAPTCHA_API_KEY in .env or in Settings sheet to use --solve');
      }
      process.exit(1);
    }
  }

  if (
    captchaType === 'turnstile' &&
    captchaInfo.solution &&
    form.length
  ) {
    const turnstileFormData: Record<string, string> = {};
    form.find('input[name]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      if (name) turnstileFormData[name] = value;
    });
    turnstileFormData['cf-turnstile-response'] = captchaInfo.solution;

    logger.info('Submitting Turnstile token to pass Cloudflare...');
    try {
      const passRes = await fetch(formUrl, {
        method: 'POST',
        redirect: 'follow' as const,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: getCookieHeader(),
          Referer: resUrl || VFS_LOGIN_URL,
        },
        body: new URLSearchParams(turnstileFormData),
      });
      const passHtml = await (passRes as { text: () => Promise<string> }).text();
      const $pass = cheerio.load(passHtml);
      const passTitle = ($pass('title').text() || '').trim();
      console.log('\n--- After Turnstile submit ---');
      console.log('Status:', (passRes as { status: number }).status);
      console.log('Final URL:', (passRes as { url: string }).url);
      console.log('Page title:', passTitle);
      if (!passTitle.includes('Just a moment')) {
        console.log(
          'Cloudflare challenge may be passed. You can use the cookies from this response for further requests.'
        );
      }
    } catch (e) {
      console.log('Turnstile submit failed:', formatErrorForLog(e));
    }
  }

  if (doLogin && captchaType) {
    if (!captchaInfo.solution) {
      console.error(
        'Login requires solving captcha first. Run with --solve --email ... --password ...'
      );
      process.exit(1);
    }
    const email = options.email!;
    const password = options.password!;

    const formData: Record<string, string> = {};
    form.find('input[name]').each((_, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      const type = ($(el).attr('type') || '').toLowerCase();
      if (name && type !== 'submit' && type !== 'image') formData[name] = value;
    });

    const emailKey = form
      .find('input[type="email"], input[name*="mail"], input[name*="user"]')
      .attr('name');
    const passwordKey = form.find('input[type="password"]').attr('name');
    if (emailKey) formData[emailKey] = email;
    else formData['email'] = email;
    if (passwordKey) formData[passwordKey] = password;
    else formData['password'] = password;

    if (captchaType === 'recaptcha') {
      formData['g-recaptcha-response'] = captchaInfo.solution!;
    } else if (captchaType === 'turnstile') {
      formData['cf-turnstile-response'] = captchaInfo.solution!;
    } else {
      const captchaInputName =
        form.find('input[name*="captcha"], input[name*="captcha_response"]').attr('name') ?? 'captcha';
      formData[captchaInputName] = captchaInfo.solution!;
    }

    logger.info('Submitting login (with solved captcha)...');
    const postRes = await fetch(formUrl, {
      method: (formMethod === 'get' ? 'GET' : 'POST') as 'GET' | 'POST',
      redirect: 'manual' as const,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: getCookieHeader(),
        Referer: VFS_LOGIN_URL,
      },
      body: formMethod === 'get' ? undefined : new URLSearchParams(formData),
    });

    const location = (postRes as { headers: { get: (n: string) => string } }).headers.get('location') || '';
    const body = await (postRes as { text: () => Promise<string> }).text();
    console.log('\n--- Login response ---');
    console.log('Status:', (postRes as { status: number }).status);
    console.log('Location:', location || '(none)');
    console.log('Body length:', body.length);
    if (body.length < 500) console.log('Body:', body);
    else console.log('Body (first 400 chars):', body.substring(0, 400));
  }

  console.log('\nDone.');
}
