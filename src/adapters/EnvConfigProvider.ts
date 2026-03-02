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

/**
 * Adapter: config from env + Settings sheet (UserRepository).
 * Initializes repo with env credentials, then merges sheet overrides.
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
    return { ...env, ...overrides } as AppConfig;
  }
}
