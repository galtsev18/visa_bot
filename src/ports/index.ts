/**
 * Ports (interfaces) for the application.
 * Implementations live in adapters; domain and use cases depend only on these.
 */

export type { AppConfig } from './AppConfig';
export type {
  ConfigProvider,
} from './ConfigProvider';
export type {
  DateCache,
  DateCacheClient,
  RefreshDatesOptions,
} from './DateCache';
export type { NotificationSender } from './NotificationSender';
export type { User, UserData } from './User';
export type {
  UserRepository,
  SettingsOverrides,
  BookingAttemptLog,
} from './UserRepository';
export type {
  VisaProvider,
  VisaCredentials,
  ProviderSession,
} from './VisaProvider';
