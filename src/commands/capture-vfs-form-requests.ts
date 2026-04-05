/**
 * Log in to VFS via Puppeteer (with 2Captcha for captcha), then click "Start New Booking",
 * select centre/category/subcategory from the credentials file, and capture all XHR/fetch
 * requests (URL, method, postData). Writes .tmp/vfs-captured-requests.json.
 *
 * Requires: run get-vfs-login-credentials first. Proxy (GEONIX_API_KEY, VFS_PROXY_COUNTRY)
 * and CAPTCHA_2CAPTCHA_API_KEY from Settings sheet or .env; or --visible for manual captcha.
 *
 * Use --with-time to run the same date click + slot read as the bot (more XHR for time/booking APIs).
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, readSettingsFromSheet } from '../lib/sheets';
import { resolveVfsProxy } from '../lib/geonixProxy';
import { localeFromLoginUrl } from '../lib/vfsUtils';
import {
  vfsBrowserLogin,
  vfsGetAvailableDatesFromPage,
  vfsGetAvailableTimeFromPage,
} from '../lib/providers/vfsBrowserFlow';
import { logger } from '../lib/logger';

const OUT_DIR = '.tmp';
const OUT_FILE = 'vfs-captured-requests.json';
const CREDS_FILE = 'vfs-login.json';

interface CapturedRequest {
  url: string;
  method: string;
  postData?: string;
  timestamp: number;
}

export async function captureVfsFormRequestsCommand(options: {
  visible?: boolean;
  /** After loading dates, click first available day and read time slots (more XHR for slot APIs). */
  withTime?: boolean;
}): Promise<void> {
  const envConfig = getConfig();
  validateEnvForSheets(envConfig);
  await initializeSheets(envConfig.googleCredentialsPath!, envConfig.googleSheetsId!);
  const sheetSettings = (await readSettingsFromSheet()) as Record<string, unknown>;
  const config = { ...envConfig, ...sheetSettings };
  const credsPath = join(process.cwd(), OUT_DIR, CREDS_FILE);
  let creds: {
    email: string;
    password: string;
    loginUrl: string;
    vfs_centre?: string;
    vfs_category?: string;
    vfs_sub_category?: string;
  };
  try {
    creds = JSON.parse(await readFile(credsPath, 'utf8'));
  } catch {
    throw new Error(`Run 'npm start -- get-vfs-login-credentials' first to create ${credsPath}`);
  }
  const locale = localeFromLoginUrl(creds.loginUrl);
  const proxy = await resolveVfsProxy({
    vfsProxyUrl: config.vfsProxyUrl ?? null,
    geonixApiKey: config.geonixApiKey ?? null,
    geonixProxyListType: config.geonixProxyListType ?? null,
    vfsProxyCountry: config.vfsProxyCountry ?? null,
  });
  if (proxy) logger.info(`Using VFS proxy: ${proxy.server}`);
  const captured: CapturedRequest[] = [];
  const session = await vfsBrowserLogin({
    locale,
    email: creds.email,
    password: creds.password,
    captchaApiKey: config.captcha2CaptchaApiKey ?? undefined,
    headless: !options.visible,
    timeout: 90000,
    formTimeout: 45000,
    proxy: proxy ?? undefined,
  });
  const page = session.page as {
    on: (ev: string, fn: (req: { url: () => string; method: () => string; postData: () => string | undefined; resourceType?: () => string }) => void) => void;
  };
  page.on('request', (req) => {
    const rt = req.resourceType?.();
    if (rt === 'xhr' || rt === 'fetch') {
      captured.push({
        url: req.url(),
        method: req.method(),
        postData: req.postData() ?? undefined,
        timestamp: Date.now(),
      });
    }
  });
  const params = {
    visa_center: creds.vfs_centre || 'Visa Application Centre',
    visa_category: creds.vfs_category || 'Visit',
    visa_sub_category: creds.vfs_sub_category || 'Standard',
  };
  logger.info('Running Start New Booking and selecting options to capture requests...');
  const dates = await vfsGetAvailableDatesFromPage(session.page, params);
  if (options.withTime && dates.length > 0) {
    const first = dates[0];
    logger.info(`--with-time: resolving time for first available date ${first}...`);
    const t = await vfsGetAvailableTimeFromPage(session.page, first);
    logger.info(`--with-time: first slot read as: ${t ?? '(none)'}`);
  } else if (options.withTime && dates.length === 0) {
    logger.warn('--with-time: no dates returned; skip time step');
  }
  const browser = session.browser as { close: () => Promise<void> };
  await browser.close();
  const outPath = join(process.cwd(), OUT_DIR, OUT_FILE);
  await mkdir(join(process.cwd(), OUT_DIR), { recursive: true });
  await writeFile(outPath, JSON.stringify(captured, null, 2), 'utf8');
  logger.info(`Captured ${captured.length} requests to ${outPath}`);
  if (captured.length > 0) {
    captured.forEach((r, i) => {
      logger.info(`[${i + 1}] ${r.method} ${r.url}`);
      if (r.postData) logger.info(`    body: ${r.postData.slice(0, 200)}${r.postData.length > 200 ? '...' : ''}`);
    });
  }
}
