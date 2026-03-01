# Архитектура проекта

Текущее состояние, целевая архитектура и итог миграции. Требования к системе (фичи, настройки) — в [REQUIREMENTS.md](REQUIREMENTS.md).

## 1. Текущее состояние

### 1.1 Стек и зависимости

- **Runtime:** Node.js, ESM
- **CLI:** Commander
- **HTTP:** node-fetch
- **Парсинг:** cheerio, chrono-node
- **Интеграции:** googleapis (Sheets), Telegram Bot API (через fetch)
- **Логирование:** pino (структурированные логи, уровни через `LOG_LEVEL`)
- **Опционально:** Puppeteer + stealth (для VFS/Cloudflare)

### 1.2 Структура кода (упрощённо)

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
├── ports/                # Интерфейсы
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
    ├── fallbackAdapters.js  # JS-обёртки над lib для пути без composition root
    ├── captcha.js        # 2Captcha
    ├── browserCloudflare.js
    └── providers/
        ├── base.js       # Интерфейс VisaProvider (JSDoc)
        ├── ais.js        # AisProvider — обёртка над VisaHttpClient
        └── vfsglobal.js  # VfsGlobalClient (в заделе)
```

### 1.3 Выявленные проблемы архитектуры

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

## 2. Целевая архитектура

### 2.1 Принципы

- **Чёткие слои:** домен → применение (use cases) → инфраструктура (HTTP, Sheets, Telegram, кэш).
- **Зависимости внутрь:** домен не знает про Telegram/Sheets; адаптеры реализуют порты.
- **Один вход:** конфиг и контейнер зависимостей в composition root (DI).
- **Типизация:** TypeScript для контрактов и рефакторинга.
- **Тестируемость:** домен и сценарии без реальных I/O; интеграционные тесты опционально.

### 2.2 Слои

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

### 2.3 Ключевые абстракции

- **VisaProvider:** `login(credentials)`, `getAvailableDates(...)`, `getAvailableTime(...)`, `book(...)`. Реализации: AIS (client.js), VFS Global.
- **UserRepository:** getActiveUsers, updateLastChecked, updateCurrentDate, updateLastBooked, logBookingAttempt, readSettings. Реализация: Sheets (sheets.js) или БД/API.
- **DateCache:** по провайдеру get/set/isStale/refreshDates. Реализации: in-memory; in-memory + Sheets.
- **ConfigProvider:** `getConfig(): AppConfig`. Реализация: .env + Settings.
- **NotificationSender:** `send(message, chatId)`. Реализация: Telegram.
- **User (домен):** email, currentDate, dateRanges, reactionTime, isDateValid(), needsAppointment(), provider.
- **Rotation (домен/приложение):** выбор следующего пользователя по приоритету без доступа к Sheets.

### 2.4 Конфигурация и запуск

- Один **AppConfig**. Сборка: .env → переопределение из Settings при старте monitor.
- **Composition root** (`composition/`): создание адаптеров и передача в use cases.

### 2.5 Технологии

- TypeScript, структура по слоям (domain, application, adapters, cli).
- Тесты: юнит для домена и сценариев (моки портов), при необходимости интеграционные.
- ESLint, Prettier, структурированный логгер (pino) с уровнями.

---

## 3. План перехода (завершён)

Все фазы 0–5 выполнены. Текущее состояние:

- **Порты и адаптеры:** контракты в `ports/` (AppConfig, ConfigProvider, DateCache, NotificationSender, UserRepository, VisaProvider, User). DateCache, NotificationSender, ConfigProvider, UserRepository, VisaProvider — реализованы; composition root (`createMonitorContext.ts`) и fallback (`createFallbackAdapters()`) передают их в UserBotManager.
- **Use cases:** `startMonitor`, `checkUserWithCache`, `attemptBooking` в `src/application/`; UserBotManager — оркестратор.
- **Домен:** User, userRotation без импортов из адаптеров.
- **Инфраструктура:** pino (LOG_LEVEL), обработка ошибок на границе CLI, команда `health`, метрики в файле.
- **CI:** lint, typecheck, test в `.github/workflows/ci.yml`.

Дальнейшие улучшения (по желанию): полная миграция application/ на TypeScript, интеграционные тесты, сокращение глобального состояния в lib (sheets, dateCache, telegram).

---

## 4. Итог

При эволюции кода важно: сохранять набор фич ([REQUIREMENTS.md](REQUIREMENTS.md)); держать границы домена, use cases, портов и адаптеров; унифицировать провайдеры через VisaProvider и фабрику; минимизировать глобальное состояние (DI в composition root); развивать TypeScript и тесты.

Переход по фазам 0–5 выполнен; оставшиеся улучшения — по необходимости (раздел 3).
