import type { AppConfig } from './AppConfig.js';

/**
 * Port: provide application config (env + optional overrides).
 * Validation can happen inside getConfig() or at composition root.
 * @implemented_by EnvConfigProvider (adapters)
 */
export interface ConfigProvider {
  getConfig(): AppConfig;
}
