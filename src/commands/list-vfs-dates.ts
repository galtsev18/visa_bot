/**
 * Browser login + vfsGetAvailableDatesFromPage — same path as production VFS flow.
 * Reads .tmp/vfs-login.json (run get-vfs-login-credentials first).
 * Geonix / VFS proxy: Settings — GEONIX_API_KEY, VFS_PROXY_COUNTRY, optional GEONIX_PROXY_LIST_TYPE (ipv4|…); VFS_PROXY_URL overrides Geonix.
 * **2Captcha:** `CAPTCHA_2CAPTCHA_API_KEY` from Settings sheet or `.env` — passed to `vfsBrowserLogin` for Cloudflare Turnstile / login captcha (same as monitor). Use `--visible` only if headless still fails (Cloudflare JS-only, etc.).
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getConfig, validateEnvForSheets } from '../lib/config';
import { initializeSheets, readSettingsFromSheet } from '../lib/sheets';
import { localeFromLoginUrl } from '../lib/vfsUtils';
import { resolveVfsProxy } from '../lib/geonixProxy';
import { vfsBrowserLogin, vfsGetAvailableDatesFromPage } from '../lib/providers/vfsBrowserFlow';
import { logger } from '../lib/logger';

const CREDS_FILE = '.tmp/vfs-login.json';

export async function listVfsDatesCommand(options: {
  visible?: boolean;
  /** Commander: --no-proxy sets proxy to false */
  proxy?: boolean;
}): Promise<void> {
  const envConfig = getConfig();
  validateEnvForSheets(envConfig);
  await initializeSheets(envConfig.googleCredentialsPath!, envConfig.googleSheetsId!);
  const sheetSettings = (await readSettingsFromSheet()) as Record<string, unknown>;
  const config = { ...envConfig, ...sheetSettings } as {
    captcha2CaptchaApiKey?: string | null;
    geonixApiKey?: string | null;
    geonixProxyListType?: string | null;
    vfsProxyCountry?: string | null;
    vfsProxyUrl?: string | null;
  };

  const credsPath = join(process.cwd(), CREDS_FILE);
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
    throw new Error(`Create ${credsPath} first: npm start -- get-vfs-login-credentials`);
  }

  const locale = localeFromLoginUrl(creds.loginUrl);
  const useProxy = options.proxy !== false;
  const resolvedProxy = useProxy
    ? await resolveVfsProxy({
        vfsProxyUrl: config.vfsProxyUrl ?? null,
        geonixApiKey: config.geonixApiKey ?? null,
        geonixProxyListType: config.geonixProxyListType ?? null,
        vfsProxyCountry: config.vfsProxyCountry ?? null,
      })
    : null;
  if (resolvedProxy) logger.info(`Using VFS proxy: ${resolvedProxy.server}`);
  if (!useProxy) logger.info('list-vfs-dates: direct connection (--no-proxy)');

  if (config.captcha2CaptchaApiKey?.trim()) {
    logger.info('list-vfs-dates: 2Captcha key configured — automatic Turnstile/captcha solve enabled');
  } else {
    logger.warn(
      'list-vfs-dates: no CAPTCHA_2CAPTCHA_API_KEY (Settings sheet or .env) — add it or use --visible for manual captcha'
    );
  }

  const session = await vfsBrowserLogin({
    locale,
    email: creds.email,
    password: creds.password,
    captchaApiKey: config.captcha2CaptchaApiKey ?? undefined,
    headless: options.visible !== true,
    timeout: 180000,
    formTimeout: 240000,
    proxy: resolvedProxy ?? undefined,
  });

  try {
    const params = {
      visa_center: creds.vfs_centre || 'Visa Application Centre',
      visa_category: creds.vfs_category || 'Visit',
      visa_sub_category: creds.vfs_sub_category || 'Standard',
    };
    logger.info(`Centre/category/subcategory: ${params.visa_center} / ${params.visa_category} / ${params.visa_sub_category}`);
    const dates = await vfsGetAvailableDatesFromPage(session.page, params);
    // Single JSON line for scripts; human-readable block for terminals
    console.log(JSON.stringify({ ok: true, count: dates.length, dates }, null, 2));
  } finally {
    await (session.browser as { close: () => Promise<void> }).close();
  }
}
