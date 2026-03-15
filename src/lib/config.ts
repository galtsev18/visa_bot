import dotenv from 'dotenv';

dotenv.config();

export interface EnvConfig {
  email?: string;
  password?: string;
  scheduleId?: string;
  countryCode?: string;
  refreshDelay: number;
  googleSheetsId?: string;
  googleCredentialsPath?: string;
  telegramBotToken?: string;
  telegramManagerChatId?: string;
  facilityId: number;
  refreshInterval: number;
  sheetsRefreshInterval: number;
  cacheTtl: number;
  rotationCooldown: number;
  aisRequestDelaySec: number;
  aisRateLimitBackoffSec: number;
  vfsRequestDelaySec: number;
  vfsRateLimitBackoffSec: number;
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: null;
  /** Geonix API key for fetching proxies (VFS cabinet from country-specific IP, e.g. Russia) */
  geonixApiKey?: string | null;
  /** Country for VFS proxy when using Geonix (e.g. Russia). Ignored if vfsProxyUrl is set. */
  vfsProxyCountry?: string | null;
  /** Manual proxy URL for VFS (e.g. http://user:pass@host:port). Overrides Geonix when set. */
  vfsProxyUrl?: string | null;
}

export function getConfig(): EnvConfig {
  return {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: Number(process.env.REFRESH_DELAY || 3),
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramManagerChatId: process.env.TELEGRAM_MANAGER_CHAT_ID,
    facilityId: Number(process.env.FACILITY_ID || 134),
    refreshInterval: Number(process.env.REFRESH_INTERVAL || 5),
    sheetsRefreshInterval: Number(process.env.SHEETS_REFRESH_INTERVAL || 400),
    cacheTtl: Number(process.env.CACHE_TTL || 90),
    rotationCooldown: Number(process.env.ROTATION_COOLDOWN || 45),
    aisRequestDelaySec: Number(process.env.AIS_REQUEST_DELAY_SEC || 2),
    aisRateLimitBackoffSec: Number(process.env.AIS_RATE_LIMIT_BACKOFF_SEC || 30),
    vfsRequestDelaySec: Number(process.env.VFS_REQUEST_DELAY_SEC || 3),
    vfsRateLimitBackoffSec: Number(process.env.VFS_RATE_LIMIT_BACKOFF_SEC || 45),
    captcha2CaptchaApiKey: process.env.CAPTCHA_2CAPTCHA_API_KEY || null,
    captchaSolver: null,
    geonixApiKey: process.env.GEONIX_API_KEY || null,
    vfsProxyCountry: process.env.VFS_PROXY_COUNTRY || null,
    vfsProxyUrl: process.env.VFS_PROXY_URL || null,
  };
}

export function validateEnvForSheets(config: EnvConfig): void {
  const required = ['googleSheetsId', 'googleCredentialsPath'];
  const c = config as unknown as Record<string, unknown>;
  const missing = required.filter((key) => !c[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required .env variables: ${missing.map((k) => k.toUpperCase()).join(', ')}`
    );
    process.exit(1);
  }
}

export function validateMultiUserConfig(config: EnvConfig): void {
  const required = ['googleSheetsId', 'googleCredentialsPath', 'telegramBotToken', 'telegramManagerChatId'];
  const c = config as unknown as Record<string, unknown>;
  const missing = required.filter((key) => !c[key]);
  if (missing.length > 0) {
    console.error(`Missing required config (set in .env or Settings sheet): ${missing.join(', ')}`);
    process.exit(1);
  }
}

export function getBaseUri(countryCode: string): string {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
