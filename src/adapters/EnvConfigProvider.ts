import type { AppConfig } from '../ports/AppConfig.js';
import type { ConfigProvider } from '../ports/ConfigProvider.js';
import { getConfig as getConfigFromEnv } from '../lib/config.js';

/**
 * Adapter: config from .env only (via existing getConfig).
 * Sheet overrides are merged in monitor command for now.
 */
export class EnvConfigProvider implements ConfigProvider {
  getConfig(): AppConfig {
    return getConfigFromEnv() as AppConfig;
  }
}
