/**
 * Application configuration (env + optional overrides from Settings sheet).
 * All settings the app needs in one type.
 * @see ConfigProvider.getConfig()
 */
export interface AppConfig {
  // Legacy single-user (backward compatibility)
  email?: string;
  password?: string;
  scheduleId?: string;
  countryCode?: string;
  refreshDelay: number;

  // Multi-user / monitor
  googleSheetsId?: string;
  googleCredentialsPath?: string;
  telegramBotToken?: string;
  telegramManagerChatId?: string;
  facilityId: number;
  refreshInterval: number;
  sheetsRefreshInterval: number;
  cacheTtl: number;
  rotationCooldown: number;

  // AIS rate limiting
  aisRequestDelaySec: number;
  aisRateLimitBackoffSec: number;

  // Optional: 2Captcha for VFS
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;
}
