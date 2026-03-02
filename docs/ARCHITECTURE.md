# Архитектура проекта

Текущая структура и слои. Требования — в [REQUIREMENTS.md](REQUIREMENTS.md). Техдолг — в [TECH_DEBT.md](TECH_DEBT.md), планы — в [ROADMAP.md](ROADMAP.md).

**Документация:** [docs/README.md](README.md) — оглавление; [REQUIREMENTS.md](REQUIREMENTS.md) (фичи) · [DIAGRAMS.md](DIAGRAMS.md) (C4, DFD, sequence) · [CONTRACTS.md](CONTRACTS.md) (порты) · [VFS_GLOBAL.md](VFS_GLOBAL.md) (VFS) · [DEPLOY.md](../DEPLOY.md) (деплой).

---

## 1. Стек и структура

### 1.1 Зависимости

- **Runtime:** Node.js 18+, ESM (`engines.node` в package.json)
- **CLI:** Commander
- **HTTP:** встроенный `fetch` (Node 18+), без node-fetch
- **Парсинг:** cheerio, chrono-node
- **Интеграции:** googleapis (Sheets), Telegram Bot API (fetch к api.telegram.org)
- **Логирование:** pino (`LOG_LEVEL`)
- **Опционально:** Puppeteer + stealth (VFS/Cloudflare)

**Состояние в lib:** в `lib/sheetsClientCore.ts` — низкоуровневый API Google Sheets (get, batchGet, update, batchUpdate, append, getSpreadsheetMetadata, addSheets) и quota retry с состоянием; в `lib/sheets.ts` — доменный API (Users, Cache, Logs, Settings), использует core; фабрика `createSheetsClient(credentialsPath, sheetId)` возвращает экземпляр с собственным состоянием; `initializeSheets()` создаёт клиент по умолчанию для legacy-экспортов. В `lib/telegram.ts` — фабрика `createTelegramSender()`. В `lib/dateCache.ts` — фасад `createDateCache()`. Команда monitor подписывается на квоты через `repo.setQuotaNotifier()`. В `createMonitorContext(opts)` опционально передаются `opts.repo` и `opts.notifications` для подмены адаптеров (интеграционные тесты).

### 1.2 Дерево исходников

```
src/
├── index.ts                    # CLI: команды и роутинг
├── commands/
│   ├── monitor.ts              # Multi-user: только composition root → UserBotManager (deps обязательны)
│   ├── bot.ts                   # Single-user (legacy)
│   ├── health.ts                # Метрики и проверка работы
│   ├── get-chat-id.ts
│   ├── test-sheets.ts
│   └── test-vfs-captcha.ts
├── composition/
│   └── createMonitorContext.ts # Composition root: адаптеры + конфиг для monitor
├── application/                # Use cases
│   ├── startMonitor.ts
│   ├── checkUserWithCache.ts
│   ├── attemptBooking.ts
│   └── types.ts
├── adapters/                   # Реализации портов
│   ├── SheetsUserRepository.ts
│   ├── DateCacheAdapter.ts
│   ├── EnvConfigProvider.ts
│   ├── TelegramNotificationAdapter.ts
│   ├── VisaProviderFactory.ts
│   ├── ProviderBackedClient.ts  # Обёртка VisaProvider → интерфейс как у VisaHttpClient
│   └── VfsGlobalProviderAdapter.ts
├── domain/                     # Домен: сущности и правила без I/O
│   ├── dateUtils.ts            # ParsedDateRange, isDateInRanges, formatDate
│   ├── User.ts                 # Класс User (порт User)
│   └── userRotation.ts         # getNextUser, updateUserPriority, getRotationStats
├── ports/                      # Интерфейсы
│   ├── AppConfig.ts
│   ├── ConfigProvider.ts
│   ├── DateCache.ts
│   ├── NotificationSender.ts
│   ├── UserRepository.ts
│   ├── VisaProvider.ts
│   └── User.ts
└── lib/
    ├── config.ts, logger.ts, utils.ts
    ├── user.ts                 # Фабрика createUser(raw) → domain User
    ├── userBotManager.ts       # Оркестратор monitor
    ├── bot.ts, client.ts             # Один бот и AIS HTTP
    ├── dateCache.ts, dateParser.ts
    ├── sheets.ts, sheetsClientCore.ts
    ├── telegram.ts
    ├── fallbackAdapters.ts            # Не используется командой monitor (оставлен для возможных утилит)
    ├── metrics.ts                    # Метрики для health
    ├── captcha.ts, browserCloudflare.ts
    └── providers/
        ├── base.ts, ais.ts, vfsglobal.ts
```

### 1.3 Запуск и сборка

| Действие | Команда | Описание |
|----------|---------|----------|
| Разработка | `npm run dev` | Запуск из `src` через tsx (TypeScript на лету). |
| Продакшен | `npm start` | Запуск из `src` через tsx (тот же путь, что и dev). |
| Только dist | `npm run start:dist` | Запуск уже собранного `dist/index.js` (после `npm run build`). |
| Тесты | `npm test` | Node test runner с tsx (подгрузка .ts). |
| Сборка | `npm run build` | tsc → `dist/` (опционально, для деплоя через node). |

Исходники в `src` не импортируют из `dist`. В `package.json` поле `"main": "dist/index.js"` задаёт точку входа при запуске из собранного артефакта; основной путь запуска (dev и production) — из исходников через `npm start` или `npm run dev`.

**Рекомендуемый способ запуска:**
- **Разработка и продакшен:** `npm run dev` или `npm start` — оба запускают `tsx src/index.ts`; composition root и адаптеры подгружаются из исходников. Подходит для команд monitor, bot, test-sheets и т.д., в том числе для провайдера VFS Global.
- **Запуск из dist:** при необходимости собрать и запускать через Node без tsx: `npm run build && npm run start:dist` (требует, чтобы сборка давала runnable ESM с расширениями в путях; при текущем `moduleResolution: "Bundler"` dist может быть непригоден для прямого запуска через `node`).
- Команда `monitor` всегда инициализируется через composition root; UserBotManager получает обязательные зависимости (repo, dateCache, notifications) из него.

---

## 2. Слои и порты

**Порты** — это интерфейсы (контракты) между приложением и внешним миром: «как получить пользователей», «как отправить уведомление», «как спросить слоты у системы записи». Код use cases зависит только от портов, а не от Google Sheets или Telegram. Конкретные реализации (Sheets, Telegram, AIS API) живут в **адаптерах** и подставляются при запуске (composition root). Так можно заменить источник данных или канал уведомлений без переписывания сценариев. Подход называется «порты и адаптеры» (hexagonal architecture).

### 2.1 Схема

```
CLI (monitor, bot, health, test-*)
        ↓
Application (startMonitor, checkUserWithCache, attemptBooking)
        ↓
Domain (User, userRotation, dateUtils) — без I/O, в src/domain/
        ↑
Ports (UserRepository, DateCache, ConfigProvider, NotificationSender, VisaProvider, User)
        ↑
Adapters (Sheets, EnvConfig, DateCacheAdapter, Telegram, AIS/VFS)
```

Домен не импортирует из application, adapters, lib; только из ports (интерфейс User). Создание User из сырых данных (sheet/env) — фабрика `createUser()` в lib/user.ts.

### 2.2 Ключевые абстракции

- **VisaProvider:** `login`, `getAvailableDates`, `getAvailableTime`, `book`. Реализации: AIS (lib + ProviderBackedClient), VFS (VfsGlobalProviderAdapter).
- **UserRepository:** `getActiveUsers`, `getSettingsOverrides`, `getInitialData`, обновления и лог попыток. Реализация: SheetsUserRepository.
- **DateCache:** по провайдеру: `getAvailableDates`, `isDateAvailable`, `isCacheStale`, `initialize`, `updateDate`, `refreshAllDates`, `getCacheStats`. Реализация: DateCacheAdapter (обёртка над lib/dateCache).
- **ConfigProvider:** `getConfig(): Promise<AppConfig>`. Реализации: EnvConfigProvider (только env), MergedConfigProvider (env + Settings).
- **NotificationSender:** `send(message, chatId)`. Реализация: TelegramNotificationAdapter.

---

## 3. Перезапуск и масштабирование

- **Один процесс:** монитор рассчитан на один инстанс (вертикальное масштабирование). Горизонтальное масштабирование (несколько процессов/воркеров) не заложено.
- **Перезапуск во время цикла:** при падении или перезапуске процесса цикл проверки пользователей прерывается. При следующем запуске монитор снова загружает пользователей и кэш из хранилища (Sheets); повторная проверка тех же пользователей допустима. Идемпотентность: чтение слотов и обновление lastChecked — идемпотентны; успешный букинг меняет состояние записи, повторная отправка формы букинга на ту же дату может привести к ошибке или дублированию со стороны AIS/VFS — не запускать два монитора на одних и тех же пользователях без координации.
- **Границы при многопроцессном запуске:** при возможном появлении нескольких процессов (очередь задач, несколько воркеров) необходимо: (1) разделять пользователей между инстансами (например, по диапазону строк или по ключу) или использовать блокировки/очередь; (2) не выполнять букинг для одного и того же пользователя из двух процессов одновременно. Сейчас координация не реализована — рекомендуется один процесс monitor на одну таблицу/набор пользователей.
