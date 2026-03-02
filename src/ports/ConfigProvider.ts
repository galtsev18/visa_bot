import type { AppConfig } from './AppConfig';

/**
 * Port: provide application config (env + optional overrides from storage).
 * Implementations may merge env with Settings sheet or other sources.
 * @implemented_by EnvConfigProvider, MergedConfigProvider (adapters)
 */
export interface ConfigProvider {
  getConfig(): Promise<AppConfig>;
}
