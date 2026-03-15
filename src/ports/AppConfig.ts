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

  // AIS rate limiting (per-provider timings)
  aisRequestDelaySec: number;
  aisRateLimitBackoffSec: number;

  // VFS rate limiting / timeouts (used when provider === vfsglobal)
  vfsRequestDelaySec: number;
  vfsRateLimitBackoffSec: number;

  // Optional: 2Captcha for VFS
  captcha2CaptchaApiKey?: string | null;
  captchaSolver?: ((params: unknown) => Promise<string>) | null;

  // VFS proxy (cabinet often only from country IP, e.g. Russia; Geonix: https://geonix.com)
  geonixApiKey?: string | null;
  vfsProxyCountry?: string | null;
  vfsProxyUrl?: string | null;
}
