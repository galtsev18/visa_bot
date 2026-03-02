# Контракты API (порты)

Спецификация портов приложения: интерфейсы между use cases и внешним миром. Реализации — в адаптерах (см. [ARCHITECTURE.md](ARCHITECTURE.md)). Используются для моков в тестах и для согласования изменений.

Связано: [REQUIREMENTS.md](REQUIREMENTS.md) · [TESTING.md](TESTING.md) · [DIAGRAMS.md](DIAGRAMS.md).

---

## 1. VisaProvider

**Назначение:** единый контур работы с системой записи на собеседование (AIS, VFS Global). Логин, получение доступных дат/времени, букинг.

**Файл:** `src/ports/VisaProvider.ts`

### Типы

| Тип | Описание |
|-----|----------|
| `VisaCredentials` | `{ email, password, countryCode, scheduleId?, facilityId? }` |
| `ProviderSession` | `Record<string, unknown>` — непрозрачная сессия (cookies/headers), формат знает адаптер |

### Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `name` | `readonly name: string` | Идентификатор провайдера (например `'ais'`, `'vfsglobal'`) |
| `login` | `login(credentials: VisaCredentials): Promise<ProviderSession>` | Аутентификация. При ошибке — reject. |
| `getAvailableDates` | `getAvailableDates(session, scheduleId, facilityId): Promise<string[]>` | Список доступных дат (формат YYYY-MM-DD или провайдерный). |
| `getAvailableTime` | `getAvailableTime(session, scheduleId, facilityId, date): Promise<string \| null>` | Доступное время на дату; `null` если слотов нет. |
| `book` | `book(session, scheduleId, facilityId, date, time): Promise<void>` | Бронирование. При ошибке — reject. |

**Реализации:** AIS — lib + `ProviderBackedClient`; VFS — `VfsGlobalProviderAdapter`.

---

## 2. UserRepository

**Назначение:** хранилище пользователей, настроек, кэша дат и логов попыток букинга. Единственная точка доступа к данным пользователей и листу Settings.

**Файл:** `src/ports/UserRepository.ts`

### Типы

| Тип | Описание |
|-----|----------|
| `SettingsOverrides` | Переопределения настроек (telegramBotToken, facilityId, refreshInterval, cacheTtl, …). Ключи совпадают с полями конфига. |
| `BookingAttemptLog` | `{ user_email, date_attempted?, time_attempted?, result: 'success' \| 'failure' \| 'skipped', reason?, old_date?, new_date?, new_time? }` |

### Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `initialize` | `initialize(credentialsPath, sheetId): Promise<void>` | Подключиться к хранилищу (например, Google Sheets). Вызывать один раз до остальных методов. |
| `getActiveUsers` | `getActiveUsers(): Promise<User[]>` | Список активных пользователей (active === true). |
| `getSettingsOverrides` | `getSettingsOverrides(): Promise<SettingsOverrides>` | Переопределения из листа Settings. |
| `getInitialData` | `getInitialData(): Promise<{ users, cacheEntries }>` | Один батч: пользователи + записи кэша дат для инициализации. |
| `updateUserLastChecked` | `updateUserLastChecked(email, timestamp, rowIndex?): Promise<void>` | Обновить время последней проверки. |
| `updateUserCurrentDate` | `updateUserCurrentDate(email, newDate, timeSlot?, rowIndex?): Promise<void>` | Обновить текущую записанную дату (и время) пользователя. |
| `updateUserLastBooked` | `updateUserLastBooked(email, date, timeSlot?, rowIndex?): Promise<void>` | Обновить дату последнего успешного букинга. |
| `updateUserPriority` | `updateUserPriority(email, priority, rowIndex?): Promise<void>` | Обновить приоритет пользователя. |
| `logBookingAttempt` | `logBookingAttempt(attempt: BookingAttemptLog): Promise<void>` | Записать попытку букинга в лог. |
| `updateAvailableDate` | `updateAvailableDate(date, available, times?, facilityId?): Promise<void>` | Сохранить запись кэша дат (используется адаптером DateCache при персистентности). |

**Реализация:** `SheetsUserRepository` (при `initialize()` вызывает `initializeSheets()` из lib/sheets, что создаёт клиент по умолчанию для всех экспортов модуля). Адаптер дополнительно предоставляет `setQuotaNotifier(fn)` для подписки на квоты Sheets; команда monitor использует его для уведомлений в Telegram. Для тестов или нескольких таблиц можно использовать фабрику `createSheetsClient(credentialsPath, sheetId)` из `lib/sheets.ts` — она возвращает объект `SheetsClient` с тем же API и изолированным состоянием.

---

## 3. DateCache

**Назначение:** кэш доступных дат по провайдеру. In-memory; при персистентности — синхронизация с хранилищем (например, лист "Available Dates Cache") через UserRepository.updateAvailableDate.

**Файл:** `src/ports/DateCache.ts`

### Типы

| Тип | Описание |
|-----|----------|
| `RefreshDatesOptions` | `{ requestDelaySec?, rateLimitBackoffSec? }` — задержки при запросах к провайдеру. |
| `DateCacheClient` | Объект с `checkAvailableDate(headers, scheduleId, facilityId)` и `checkAvailableTime(headers, scheduleId, facilityId, date)` — обычно обёртка над VisaProvider/сессией. |

### Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `getAvailableDates` | `getAvailableDates(provider?: string): string[]` | Список дат в кэше для провайдера. |
| `isDateAvailable` | `isDateAvailable(date, provider?): boolean` | Есть ли дата в кэше и помечена как доступная. |
| `isCacheStale` | `isCacheStale(date, ttlSeconds, provider?): boolean` | Устарела ли запись кэша по TTL. |
| `getCacheStats` | `getCacheStats(): { total, providers: Record<string, { entries, available }> }` | Статистика по кэшу. |
| `initialize` | `initialize(preloadedEntries?): Promise<void>` | Инициализация кэша (например, из getInitialData). |
| `updateDate` | `updateDate(date, available, times?, ttlSeconds?, provider?): void` | Обновить одну запись (in-memory + при необходимости persist). |
| `refreshAllDates` | `refreshAllDates(client, sessionHeaders, scheduleId, facilityId, ttlSeconds, provider?, options?): Promise<string[]>` | Запросить даты у провайдера через client и обновить кэш; вернуть список дат. |

**Реализация:** `DateCacheAdapter` (при запуске через composition root получает экземпляр из `createDateCache()` в lib/dateCache с опцией persist; иначе использует глобальный lib/dateCache).

---

## 4. NotificationSender

**Назначение:** отправка уведомлений в канал (Telegram).

**Файл:** `src/ports/NotificationSender.ts`

### Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `send` | `send(message: string, chatId: string): Promise<boolean>` | Отправить сообщение. Возвращает успех/неуспех. |

**Реализация:** `TelegramNotificationAdapter`.

---

## 5. ConfigProvider

**Назначение:** предоставление конфигурации приложения (env и при необходимости переопределения из Settings).

**Файл:** `src/ports/ConfigProvider.ts`

### Типы

См. `AppConfig` в `src/ports/AppConfig.ts`: email, password, scheduleId, countryCode, refreshDelay, googleSheetsId, telegramBotToken, telegramManagerChatId, facilityId, refreshInterval, sheetsRefreshInterval, cacheTtl, rotationCooldown, aisRequestDelaySec, aisRateLimitBackoffSec, captcha2CaptchaApiKey, captchaSolver и т.д.

### Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `getConfig` | `getConfig(): Promise<AppConfig>` | Текущая конфигурация. Реализация может объединять env и лист Settings (MergedConfigProvider). Валидация — внутри или в composition root. |

**Реализации:** `EnvConfigProvider` (только env); `MergedConfigProvider` (env + Settings через UserRepository, инициализирует repo при первом вызове getConfig).

---

## 6. User (домен)

**Назначение:** модель пользователя с правилами валидации дат. Не порт в смысле «внешний мир», но контракт для use cases и ротации.

**Файл:** `src/ports/User.ts`

### Типы

| Тип | Описание |
|-----|----------|
| `UserData` | email, password, countryCode, scheduleId, currentDate, reactionTime, dateRanges, active, lastChecked, lastBooked, priority, provider, rowIndex? |

### Интерфейс User (расширяет UserData)

| Метод | Описание |
|-------|----------|
| `isDateValid(date)` | Дата подходит: раньше текущей записи, в одном из диапазонов, не раньше (today + reactionTime). |
| `needsAppointment()` | Нужна ли пользователю новая запись (нет текущей или есть целевая и текущая не достигнута). |
| `isDateEarlierThanCurrent(date)` | Дата раньше currentDate. |
| `isDateInRange(date)` | Дата попадает в один из dateRanges. |
| `isDateAfterReactionTime(date)` | Дата не раньше (сегодня + reactionTime дней). |

Реализация доменной модели: `src/lib/user.ts` (совместимая с интерфейсом User).

---

## 7. Изменение контрактов

- При изменении сигнатуры или семантики порта:
  1. Обновить интерфейс в `src/ports/`.
  2. Обновить все адаптеры, реализующие этот порт.
  3. Обновить данный документ (CONTRACTS.md).
  4. Обновить тесты, использующие моки порта.
  5. При значимом решении — добавить или обновить ADR.
