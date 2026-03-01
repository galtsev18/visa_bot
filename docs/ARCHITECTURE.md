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
├── application/          # Use cases (TypeScript; .js — реэкспорт из .ts, src не импортирует из dist)
│   ├── startMonitor.ts
│   ├── checkUserWithCache.ts
│   ├── attemptBooking.ts
│   └── types.ts
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

| Проблема | Где | Описание | Статус |
|----------|-----|----------|--------|
| **Дублирование AIS-логики** | `client.js` vs `providers/ais.js` | При запуске через composition root Bot получает ProviderBackedClient (AisProvider); без dist по умолчанию — VisaHttpClient. | Частично решено (один путь через провайдер при наличии адаптеров) |
| **Нет единого провайдера** | Bot, UserBotManager | Фабрика `VisaProviderFactory` и `ProviderBackedClient` есть; при загрузке адаптеров из dist используется провайдер по `user.provider`. | Решено |
| **Глобальное состояние** | sheets.js, dateCache.js, telegram.js | Модули с `let sheets`, `let cache`, `let bot`; при передаче deps из composition root вызовы идут через порты, но сами lib-модули по-прежнему с глобальным состоянием. | Актуально |
| **Смешение слоёв** | UserBotManager, monitor.js | Use cases вынесены в application/; UserBotManager — оркестратор. При отсутствии deps всё ещё импортирует lib напрямую. | Частично решено |
| **Конфиг из двух источников** | config.js + Settings sheet | .env и лист Settings смешиваются после старта; валидация в разных местах. | Актуально |
| **Нет типизации** | Весь проект | Порты и application — TypeScript; lib, commands — в основном JS с JSDoc. | Частично решено |
| **Повторяющаяся работа с Sheets** | sheets.js | Есть порт UserRepository и SheetsUserRepository; низкоуровневая логика в sheets.js с дублированием getColumnIndex, поиск по email. | Частично решено |
| **Жёсткая связь с Google Sheets** | UserBotManager | Порт UserRepository позволяет подменить источник; реализация по умолчанию — Sheets. | Решено (на уровне порта) |
| **Один процесс на всё** | monitor | Один цикл: ротация, кэш, букинг. Масштабирование только вертикальное. | Актуально |

*Статус приведён после завершения миграции (порты, адаптеры, use cases на TypeScript, composition root).*

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
- **Use cases:** `startMonitor`, `checkUserWithCache`, `attemptBooking` в `src/application/` (TypeScript); UserBotManager — оркестратор.
- **Домен:** User, userRotation без импортов из адаптеров.
- **Инфраструктура:** pino (LOG_LEVEL), обработка ошибок на границе CLI, команда `health`, метрики в файле.
- **CI:** lint, typecheck, test в `.github/workflows/ci.yml`.

Дальнейшие улучшения (по желанию): интеграционные тесты, сокращение глобального состояния в lib (sheets, dateCache, telegram).

### 3.1 Неиспользуемый код после миграции

| Что | Где | Действие |
|-----|-----|----------|
| Barrel-файл | `composition/index.ts` | Никто не импортирует из `composition/index`, только из `createMonitorContext.js`. Можно удалить или оставить для единой точки входа. |
| Публичный API кэша | `lib/dateCache.js`: `isDateCached`, `getAvailableTimes`, `getStaleDates` | Порт DateCache и адаптер их не используют; вызовов из кода нет. Сделаны внутренними (без `export`), чтобы не раздувать публичный API. |

Остальной код задействован: оба пути запуска (composition root и fallback), провайдеры, адаптеры, реэкспорты в `application/*.js`.

---

## 4. Итог

При эволюции кода важно: сохранять набор фич ([REQUIREMENTS.md](REQUIREMENTS.md)); держать границы домена, use cases, портов и адаптеров; унифицировать провайдеры через VisaProvider и фабрику; минимизировать глобальное состояние (DI в composition root); развивать TypeScript и тесты.

Переход по фазам 0–5 выполнен; оставшиеся улучшения — по необходимости (раздел 3).
