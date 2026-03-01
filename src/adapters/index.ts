/**
 * Adapters: implementations of ports (infrastructure).
 */

export { DateCacheAdapter } from './DateCacheAdapter.js';
export { EnvConfigProvider, MergedConfigProvider } from './EnvConfigProvider.js';
export { ProviderBackedClient } from './ProviderBackedClient.js';
export { SheetsUserRepository } from './SheetsUserRepository.js';
export { TelegramNotificationAdapter } from './TelegramNotificationAdapter.js';
export { createVisaProvider } from './VisaProviderFactory.js';
export type { ProviderId, VisaProviderFactoryOptions } from './VisaProviderFactory.js';
export { VfsGlobalProviderAdapter } from './VfsGlobalProviderAdapter.js';
