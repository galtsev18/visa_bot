import type { AppConfig } from '../ports/AppConfig';
import type { ConfigProvider } from '../ports/ConfigProvider';
import type { UserRepository } from '../ports/UserRepository';
import { getConfig as getConfigFromEnv } from '../lib/config';

/**
 * Adapter: config from .env only.
 */
export class EnvConfigProvider implements ConfigProvider {
  getConfig(): Promise<AppConfig> {
    return Promise.resolve(getConfigFromEnv() as AppConfig);
  }
}

/** String keys: do not override env when sheet value is empty (secrets / optional from .env). */
const KEEP_ENV_IF_SHEET_EMPTY_STRING = [
  'telegramBotToken',
  'telegramManagerChatId',
  'captcha2CaptchaApiKey',
  'geonixApiKey',
  'vfsProxyCountry',
  'vfsProxyUrl',
] as const;

/** Numeric keys: do not override env when sheet value is 0 or NaN (empty cell → Number('') === 0). */
const KEEP_ENV_IF_SHEET_EMPTY_NUMBER = [
  'facilityId',
  'refreshInterval',
  'sheetsRefreshInterval',
  'cacheTtl',
  'rotationCooldown',
  'aisRequestDelaySec',
  'aisRateLimitBackoffSec',
  'vfsRequestDelaySec',
  'vfsRateLimitBackoffSec',
] as const;

/**
 * Adapter: config from env + Settings sheet (UserRepository).
 * Initializes repo with env credentials, then merges sheet overrides.
 * Empty sheet values do not override env: string keys keep env when sheet is empty;
 * numeric keys keep env when sheet is 0 or NaN (empty cell).
 */
export class MergedConfigProvider implements ConfigProvider {
  constructor(
    private readonly envProvider: ConfigProvider,
    private readonly repo: UserRepository
  ) {}

  async getConfig(): Promise<AppConfig> {
    const env = await this.envProvider.getConfig();
    await this.repo.initialize(
      env.googleCredentialsPath!,
      env.googleSheetsId!
    );
    const overrides = await this.repo.getSettingsOverrides();
    const merged = { ...env, ...overrides } as AppConfig;

    for (const key of KEEP_ENV_IF_SHEET_EMPTY_STRING) {
      const sheetVal = overrides[key];
      const isEmpty = sheetVal === undefined || sheetVal === null || String(sheetVal).trim() === '';
      const envVal = env[key as keyof typeof env];
      if (isEmpty && envVal != null && String(envVal).trim() !== '') {
        (merged as Record<string, unknown>)[key] = envVal;
      }
    }

    for (const key of KEEP_ENV_IF_SHEET_EMPTY_NUMBER) {
      const sheetVal = overrides[key];
      const envVal = env[key as keyof typeof env];
      const sheetEmpty =
        sheetVal === undefined ||
        sheetVal === null ||
        (typeof sheetVal === 'number' && (Number.isNaN(sheetVal) || sheetVal === 0));
      if (sheetEmpty && envVal != null && typeof envVal === 'number' && !Number.isNaN(envVal)) {
        (merged as Record<string, unknown>)[key] = envVal;
      }
    }

    return merged;
  }
}
