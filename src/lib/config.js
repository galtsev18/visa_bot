import dotenv from 'dotenv';

dotenv.config();

export function getConfig() {
  const config = {
    // Legacy single-user config (kept for backward compatibility)
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: Number(process.env.REFRESH_DELAY || 3),

    // Multi-user config (.env only — never read from Settings sheet)
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramManagerChatId: process.env.TELEGRAM_MANAGER_CHAT_ID,
    facilityId: Number(process.env.FACILITY_ID || 134),
    refreshInterval: Number(process.env.REFRESH_INTERVAL || 3),
    sheetsRefreshInterval: Number(process.env.SHEETS_REFRESH_INTERVAL || 300),
    cacheTtl: Number(process.env.CACHE_TTL || 60),
    rotationCooldown: Number(process.env.ROTATION_COOLDOWN || 30),
    // AIS rate limiting: delay (sec) between each date check; backoff (sec) when socket hang up / rate limit
    aisRequestDelaySec: Number(process.env.AIS_REQUEST_DELAY_SEC || 2),
    aisRateLimitBackoffSec: Number(process.env.AIS_RATE_LIMIT_BACKOFF_SEC || 30),
    // Optional: 2Captcha API key for VFS Global login captcha (env or Settings sheet)
    captcha2CaptchaApiKey: process.env.CAPTCHA_2CAPTCHA_API_KEY || null,
    captchaSolver: null,
  };

  return config;
}

/** Validate only .env vars needed to open the spreadsheet (used before Settings sheet exists). */
export function validateEnvForSheets(config) {
  const required = ['googleSheetsId', 'googleCredentialsPath'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required .env variables: ${missing.map((k) => k.toUpperCase()).join(', ')}`
    );
    process.exit(1);
  }
}

/** Validate full config (call after merging Settings sheet so Telegram etc. can come from sheet). */
export function validateMultiUserConfig(config) {
  const required = [
    'googleSheetsId',
    'googleCredentialsPath',
    'telegramBotToken',
    'telegramManagerChatId',
  ];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    console.error(`Missing required config (set in .env or Settings sheet): ${missing.join(', ')}`);
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
