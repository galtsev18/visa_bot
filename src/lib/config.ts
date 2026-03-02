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
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: null;
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
    refreshInterval: Number(process.env.REFRESH_INTERVAL || 3),
    sheetsRefreshInterval: Number(process.env.SHEETS_REFRESH_INTERVAL || 300),
    cacheTtl: Number(process.env.CACHE_TTL || 60),
    rotationCooldown: Number(process.env.ROTATION_COOLDOWN || 30),
    aisRequestDelaySec: Number(process.env.AIS_REQUEST_DELAY_SEC || 2),
    aisRateLimitBackoffSec: Number(process.env.AIS_RATE_LIMIT_BACKOFF_SEC || 30),
    captcha2CaptchaApiKey: process.env.CAPTCHA_2CAPTCHA_API_KEY || null,
    captchaSolver: null,
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
