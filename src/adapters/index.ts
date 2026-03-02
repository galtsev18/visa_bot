/**
 * Adapters: implementations of ports (infrastructure).
 */

export { DateCacheAdapter } from './DateCacheAdapter';
export { EnvConfigProvider, MergedConfigProvider } from './EnvConfigProvider';
export { ProviderBackedClient } from './ProviderBackedClient';
export { SheetsUserRepository } from './SheetsUserRepository';
export { TelegramNotificationAdapter } from './TelegramNotificationAdapter';
export { createVisaProvider } from './VisaProviderFactory';
export type { ProviderId, VisaProviderFactoryOptions } from './VisaProviderFactory';
export { VfsGlobalProviderAdapter } from './VfsGlobalProviderAdapter';
