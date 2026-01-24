import dotenv from 'dotenv';

dotenv.config();

export function getConfig() {
  const config = {
    // Legacy single-user config (kept for backward compatibility)
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: process.env.FACILITY_ID,
    countryCode: process.env.COUNTRY_CODE,
    refreshDelay: Number(process.env.REFRESH_DELAY || 3),
    
    // Multi-user config
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramManagerChatId: process.env.TELEGRAM_MANAGER_CHAT_ID,
    facilityId: Number(process.env.FACILITY_ID || 134),
    refreshInterval: Number(process.env.REFRESH_INTERVAL || 3),
    sheetsRefreshInterval: Number(process.env.SHEETS_REFRESH_INTERVAL || 300),
    cacheTtl: Number(process.env.CACHE_TTL || 60),
    rotationCooldown: Number(process.env.ROTATION_COOLDOWN || 30)
  };

  return config;
}

export function validateMultiUserConfig(config) {
  const required = ['googleSheetsId', 'googleCredentialsPath', 'telegramBotToken', 'telegramManagerChatId'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.toUpperCase()).join(', ')}`);
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
