/**
 * Ports (interfaces) for the application.
 * Implementations live in adapters; domain and use cases depend only on these.
 */

export type { AppConfig } from './AppConfig.js';
export type {
  ConfigProvider,
} from './ConfigProvider.js';
export type {
  DateCache,
  DateCacheClient,
  RefreshDatesOptions,
} from './DateCache.js';
export type { NotificationSender } from './NotificationSender.js';
export type { User, UserData } from './User.js';
export type {
  UserRepository,
  SettingsOverrides,
  BookingAttemptLog,
} from './UserRepository.js';
export type {
  VisaProvider,
  VisaCredentials,
  ProviderSession,
} from './VisaProvider.js';
