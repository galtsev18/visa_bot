# Анализ проекта и план перехода на новую архитектуру

## 1. Текущее состояние проекта

### 1.1 Назначение

Бот для мониторинга и автоматического переноса записей на собеседование по визе США (AIS) и задел под VFS Global. Режимы: один пользователь (CLI `bot`) и мультипользовательский пул из Google Sheets (`monitor`).

### 1.2 Стек и зависимости

- **Runtime:** Node.js, ESM
- **CLI:** Commander
- **HTTP:** node-fetch
- **Парсинг:** cheerio, chrono-node
- **Интеграции:** googleapis (Sheets), Telegram Bot API (через fetch)
- **Логирование:** pino (структурированные логи, уровни через `LOG_LEVEL`)
- **Опционально:** Puppeteer + stealth (для VFS/Cloudflare)

### 1.3 Структура кода (упрощённо)

```
src/
├── index.js              # CLI: monitor, bot, get-chat-id, test-sheets, test-vfs-captcha
├── commands/
│   ├── monitor.js        # Точка входа multi-user: Sheets → UserBotManager
│   ├── bot.js            # Точка входа single-user (legacy)
│   ├── get-chat-id.js    # Утилита Telegram
│   ├── test-sheets.js    # Проверка доступа к таблице
│   └── test-vfs-captcha.js
├── composition/
│   └── createMonitorContext.ts   # Composition root для monitor (dist)
├── application/          # Use cases
│   ├── startMonitor.js
│   ├── checkUserWithCache.js
│   └── attemptBooking.js
├── adapters/             # Реализации портов
│   ├── SheetsUserRepository.js
│   ├── TelegramNotificationAdapter.js
│   ├── EnvConfigProvider.js
│   └── VisaProviderFactory.ts
├── ports/                # Интерфейсы (в заделе)
└── lib/
    ├── config.js         # .env + валидация
    ├── logger.js         # pino, уровни
    ├── user.js           # Домен: User, валидация дат
    ├── userRotation.js   # Домен: выбор следующего юзера по приоритету
    ├── userBotManager.js # Оркестратор: сценарии + ротация
    ├── bot.js            # Один бот (AIS через провайдер)
    ├── client.js         # VisaHttpClient — AIS HTTP
    ├── dateCache.js      # In-memory + лист "Available Dates Cache"
    ├── dateParser.js     # Парсинг дат (chrono)
    ├── sheets.js         # Google Sheets: Users, Cache, Logs, Settings, квоты
    ├── telegram.js       # Инициализация + sendNotification
    ├── utils.js          # sleep, log (→ logger.info), formatErrorForLog, isSocketHangupError
    ├── captcha.js        # 2Captcha
    ├── browserCloudflare.js
    └── providers/
        ├── base.js       # Интерфейс VisaProvider (JSDoc)
        ├── ais.js        # AisProvider — обёртка над VisaHttpClient
        └── vfsglobal.js  # VfsGlobalClient (в заделе)
```

### 1.4 Выявленные проблемы архитектуры

| Проблема | Где | Описание |
|----------|-----|----------|
| **Дублирование AIS-логики** | `client.js` vs `providers/ais.js` | Bot использует только `VisaHttpClient`; провайдер AIS не используется в основном потоке. |
| **Нет единого провайдера** | Bot, UserBotManager | Есть `user.provider`, кэш по провайдерам, но Bot завязан на `client.js`. Нет фабрики провайдеров. |
| **Глобальное состояние** | sheets.js, dateCache.js, telegram.js | Модули с `let sheets`, `let cache` усложняют тесты. |
| **Смешение слоёв** | UserBotManager, monitor.js | Оркестрация, кэш, Sheets, Telegram и букинг в одном месте. |
| **Конфиг из двух источников** | config.js + Settings sheet | .env и лист Settings смешиваются после старта; валидация размазана. |
| **Нет типизации** | Весь проект | Только JSDoc местами; сложнее рефакторинг и контракты. |
| **Повторяющаяся работа с Sheets** | sheets.js | Дублирование: getColumnIndex, поиск по email; нет абстракции «репозиторий». |
| **Жёсткая связь с Google Sheets** | UserBotManager | Нельзя подменить источник (БД/API) без правок по коду. |
| **Один процесс на всё** | monitor | Масштабирование только вертикальное. |

---

## 2. Функциональный набор (что сохраняем)

### 2.1 Обязательные фичи

- Мультипользовательский мониторинг из хранилища (сейчас — Google Sheets).
- Ротация пользователей с приоритетом (cooldown, lastChecked, lastBooked).
- Общий кэш дат по провайдерам с TTL и персистентностью (лист "Available Dates Cache").
- Валидация дат: раньше текущей записи, в диапазонах, не раньше (today + reaction_time).
- Букинг: слоты → выбор времени → форма; уведомления об успехе/ошибке.
- Уведомления в Telegram (успех, слот, ошибка, старт монитора, квоты Sheets).
- Поддержка нескольких провайдеров (AIS; VFS в заделе).
- Single-user режим (legacy): один пользователь из .env, целевая/минимальная дата.

### 2.2 Настройки

- Интервалы: refresh, sheets refresh, cache TTL, rotation cooldown.
- AIS: request delay, rate limit backoff.
- Telegram: bot token, manager chat id.
- Опционально: 2Captcha API key, facility_id. Источник: .env + переопределение из Settings.

### 2.3 Утилиты и команды

- `get-chat-id` — получение Telegram chat ID.
- `test-sheets` — проверка доступа к таблице.
- `test-vfs-captcha` — отладка капчи/Cloudflare для VFS.

### 2.4 Надёжность

- Учёт квот Google Sheets (429, retry, уведомление).
- Обработка сетевых ошибок и rate limit (socket hang up, backoff).
- Секреты только в env/хранилище.

---

## 3. Целевая архитектура

### 3.1 Принципы

- **Чёткие слои:** домен → применение (use cases) → инфраструктура (HTTP, Sheets, Telegram, кэш).
- **Зависимости внутрь:** домен не знает про Telegram/Sheets; адаптеры реализуют порты.
- **Один вход:** конфиг и контейнер зависимостей в composition root (DI).
- **Типизация:** TypeScript для контрактов и рефакторинга.
- **Тестируемость:** домен и сценарии без реальных I/O; интеграционные тесты опционально.

### 3.2 Слои

```
┌─────────────────────────────────────────────────────────────────┐
│  CLI (Commander) → monitor, bot, get-chat-id, test-*             │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Application (Use Cases)                                         │
│  StartMonitor, CheckUser, BookAppointment, RefreshCache           │
│  Используют только порты                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Domain                                                          │
│  User, DateRange, Slot, ProviderId; валидация дат, правила букинга│
│  Без I/O                                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Ports                                                          │
│  UserRepository, ConfigProvider, DateCache, NotificationSender   │
│  VisaProvider (login, getAvailableDates, getAvailableTime, book)│
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Adapters                                                       │
│  SheetsUserRepository, EnvConfigProvider, InMemoryDateCache,     │
│  SheetsDateCache, TelegramNotificationSender                     │
│  AisVisaProvider, VfsGlobalVisaProvider                          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Ключевые абстракции

- **VisaProvider:** `login(credentials)`, `getAvailableDates(...)`, `getAvailableTime(...)`, `book(...)`. Реализации: AIS (client.js), VFS Global.
- **UserRepository:** getActiveUsers, updateLastChecked, updateCurrentDate, updateLastBooked, logBookingAttempt, readSettings. Реализация: Sheets (sheets.js) или БД/API.
- **DateCache:** по провайдеру get/set/isStale/refreshDates. Реализации: in-memory; in-memory + Sheets.
- **ConfigProvider:** `getConfig(): AppConfig`. Реализация: .env + Settings.
- **NotificationSender:** `send(message, chatId)`. Реализация: Telegram.
- **User (домен):** email, currentDate, dateRanges, reactionTime, isDateValid(), needsAppointment(), provider.
- **Rotation (домен/приложение):** выбор следующего пользователя по приоритету без доступа к Sheets.

### 3.4 Конфигурация и запуск

- Один **AppConfig**. Сборка: .env → переопределение из Settings при старте monitor.
- **Composition root** (`composition/`): создание адаптеров и передача в use cases.

### 3.5 Технологии

- TypeScript, структура по слоям (domain, application, adapters, cli).
- Тесты: юнит для домена и сценариев (моки портов), при необходимости интеграционные.
- ESLint, Prettier, структурированный логгер (pino) с уровнями.

---

## 4. План перехода по фазам

Цель: шагами выйти на целевую архитектуру, сохраняя работоспособность.

### 4.1 Текущий прогресс (по фазам 0 → 5)

**Фаза 0 (частично)**  
- Сделано: ESLint, Prettier, TypeScript в проекте.  
- В заделе: контракты в `ports/` (типы и JSDoc).

**Фаза 1 (частично)**  
- Сделано: конфиг через провайдер (EnvConfigProvider), уведомления через адаптер (TelegramNotificationAdapter) в контуре composition root.  
- В заделе: явные порты DateCache, NotificationSender, Config; вызовы только через интерфейсы.

**Фаза 2 (частично)**  
- Сделано: SheetsUserRepository, VisaProviderFactory (AIS); composition root `createMonitorContext.ts` — при запуске из `dist` monitor использует адаптеры (репозиторий, Telegram, EnvConfig). Кэш инициализируется в цикле через `initializeCache(cacheEntries)`. В `monitor.js` при composition root вызываются `initializeTelegram(...)` и `setSheetsQuotaNotifier(...)` — паритет с fallback-путём. SheetsUserRepository: `rowIndex`, `timeSlot` без нормализации; в `sheets.js` JSDoc типы.  
- В заделе: полный порт UserRepository; VFS в фабрике.

**Фаза 3 (выполнена)**  
- Use cases в `src/application/`: `startMonitor.js`, `checkUserWithCache.js`, `attemptBooking.js`. UserBotManager — тонкий оркестратор: зависимости + сценарии + ротация.

**Фаза 4 (выполнена)**  
- Домен (User, userRotation) без импортов из адаптеров. Юнит-тесты домена (Node.js `node:test`).

**Фаза 5 (частично)**  
- Сделано: логирование (pino, `LOG_LEVEL`, `log()` → `logger.info()`); обработка ошибок (formatErrorForLog, на границе CLI — `logger.error({ err }, msg)`, без сырого stack в production); VisaProviderFactory при неизвестном `providerId` выбрасывает явную ошибку.  
- В заделе: п.15 (health endpoint, метрики).

### 4.2 Фаза 0: Подготовка

1. Добавить TypeScript (tsconfig, компиляция), .ts рядом с .js.
2. ESLint, Prettier, CI check.
3. Описать контракты в `ports/` (VisaProvider, UserRepository, DateCache, NotificationSender, AppConfig) — типы и JSDoc без смены кода.

### 4.3 Фаза 1: Порты и адаптеры

4. **DateCache:** интерфейс + адаптер (InMemory + Sheets). Вызовы только через интерфейс.
5. **NotificationSender:** интерфейс `send(text, chatId)`; telegram.js — адаптер.
6. **Config:** AppConfig + провайдер (.env + Settings). Валидация при построении конфига.

### 4.4 Фаза 2: Репозиторий и провайдеры

7. **UserRepository:** интерфейс; SheetsUserRepository из sheets.js. Monitor получает пользователей и настройки только через репозиторий.
8. **VisaProvider в контуре букинга:** зависимость от VisaProvider, фабрика по `providerId` (ais, vfsglobal). Инициализация сессии через `provider.login(credentials)`.

### 4.5 Фаза 3: Use cases и очистка

9. Сценарии: StartMonitor, CheckUserWithCache, AttemptBooking. UserBotManager — оркестратор.
10. Убрать глобальное состояние: адаптеры создаются в composition root и передаются в use cases; в тестах — моки.

### 4.6 Фаза 4: Домен и тесты

11. Домен в чистых модулях: User, валидация дат, rotation — без импортов из adapters.
12. Юнит-тесты домена и сценариев (моки портов). Интеграционные — по желанию.

### 4.7 Фаза 5: Инфраструктура

13. **Логирование (выполнено):** pino, уровни через `LOG_LEVEL`, `log()` → `logger.info()`.
14. **Обработка ошибок (выполнено):** `formatErrorForLog`, на границе CLI — `logger.error({ err }, msg)`, без сырого stack в production.
15. **Опционально:** health endpoint, метрики (проверки, букинги в час).

---

## 5. Чек-лист фич при переносе

- [x] Multi-user monitor из хранилища (Sheets или другой репозиторий)
- [x] Ротация пользователей с cooldown и приоритетом
- [x] Общий кэш дат по провайдерам с TTL
- [x] Валидация дат: раньше текущей, в диапазонах, после (today + reaction_time)
- [x] Букинг через единый VisaProvider (AIS; VFS в заделе)
- [x] Уведомления Telegram (успех, слот, ошибка, старт, квоты)
- [x] Single-user режим (bot -c/-t/-m)
- [x] Настройки из .env + переопределение из Settings/хранилища
- [x] get-chat-id, test-sheets, test-vfs-captcha
- [x] Обработка квот Sheets и сетевых ошибок/backoff
- [x] Типизация (TypeScript частично), порты и адаптеры (частично), тесты домена

---

## 6. Итог

При переходе важно:

1. **Сохранить набор фич** и семантику настроек.
2. **Ввести границы:** домен, use cases, порты, адаптеры — смена источника пользователей, провайдера или канала уведомлений без переписывания ядра.
3. **Унифицировать провайдеры** через VisaProvider и фабрику по `providerId`.
4. **Убрать глобальное состояние** — явные зависимости и DI в composition root.
5. **Добавить TypeScript и тесты** для безопасной эволюции.

План разбит на фазы так, чтобы после каждого шага приложение оставалось рабочим. Рациональный порядок: Фаза 0–1 (типы, порты кэша и уведомлений, конфиг), затем Фаза 2 (репозиторий и провайдеры), затем Фаза 3–4 (сценарии и домен).
