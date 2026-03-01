# Архитектура проекта

Текущая структура и слои. Требования — в [REQUIREMENTS.md](REQUIREMENTS.md). Техдолг — в [TECH_DEBT.md](TECH_DEBT.md), планы — в [ROADMAP.md](ROADMAP.md).

**Документация:** [docs/README.md](README.md) — оглавление; [REQUIREMENTS.md](REQUIREMENTS.md) (фичи) · [DIAGRAMS.md](DIAGRAMS.md) (C4, DFD, sequence) · [CONTRACTS.md](CONTRACTS.md) (порты) · [VFS_GLOBAL.md](VFS_GLOBAL.md) (VFS) · [DEPLOY.md](../DEPLOY.md) (деплой).

---

## 1. Стек и структура

### 1.1 Зависимости

- **Runtime:** Node.js, ESM
- **CLI:** Commander
- **HTTP:** node-fetch
- **Парсинг:** cheerio, chrono-node
- **Интеграции:** googleapis (Sheets), Telegram Bot API (fetch)
- **Логирование:** pino (`LOG_LEVEL`)
- **Опционально:** Puppeteer + stealth (VFS/Cloudflare)

### 1.2 Дерево исходников

```
src/
├── index.js                    # CLI: команды и роутинг
├── commands/
│   ├── monitor.js              # Multi-user: только composition root → UserBotManager (deps обязательны)
│   ├── bot.js                  # Single-user (legacy)
│   ├── health.js               # Метрики и проверка работы
│   ├── get-chat-id.js
│   ├── test-sheets.js
│   └── test-vfs-captcha.js
├── composition/
│   ├── createMonitorContext.ts # Composition root: адаптеры + конфиг для monitor
│   ├── createMonitorContext.js # Реэкспорт из .ts (запуск из src через tsx)
│   └── index.ts                # Barrel (не используется при импорте)
├── application/                # Use cases (TypeScript)
│   ├── startMonitor.ts
│   ├── checkUserWithCache.ts
│   ├── attemptBooking.ts
│   └── types.ts
├── application/*.js            # Реэкспорт из .ts (запуск из src через tsx)
├── adapters/                   # Реализации портов (TypeScript)
│   ├── SheetsUserRepository.ts
│   ├── DateCacheAdapter.ts
│   ├── EnvConfigProvider.ts
│   ├── TelegramNotificationAdapter.ts
│   ├── VisaProviderFactory.ts
│   ├── ProviderBackedClient.ts  # Обёртка VisaProvider → интерфейс как у VisaHttpClient
│   └── VfsGlobalProviderAdapter.ts
├── ports/                      # Интерфейсы (TypeScript)
│   ├── AppConfig.ts
│   ├── ConfigProvider.ts
│   ├── DateCache.ts
│   ├── NotificationSender.ts
│   ├── UserRepository.ts
│   ├── VisaProvider.ts
│   └── User.ts
└── lib/
    ├── config.js, logger.js, utils.js
    ├── user.js, userRotation.js       # Домен
    ├── userBotManager.js              # Оркестратор monitor
    ├── bot.js, client.js              # Один бот и AIS HTTP
    ├── dateCache.js, dateParser.js
    ├── sheets.js, telegram.js
    ├── fallbackAdapters.js            # Не используется командой monitor (оставлен для возможных утилит)
    ├── metrics.js                     # Метрики для health
    ├── captcha.js, browserCloudflare.js
    └── providers/
        ├── base.js, ais.js, vfsglobal.js
```

### 1.3 Запуск и сборка

| Действие | Команда | Описание |
|----------|---------|----------|
| Разработка | `npm run dev` | Запуск из `src` через tsx (TypeScript на лету). |
| Продакшен | `npm start` | Сборка и запуск из `dist`. |
| Только dist | `npm run start:dist` | Запуск уже собранного `dist/index.js`. |
| Тесты | `npm test` | Node test runner с tsx (подгрузка .ts). |
| Сборка | `npm run build` | tsc → `dist/`. |

Исходники в `src` не импортируют из `dist`.

**Рекомендуемый запуск:** для разработки — `npm run dev` (tsx загружает composition root из src); для продакшена и VFS — `npm run build && npm start` (сборка в `dist/`). Команда `monitor` всегда инициализируется через composition root; UserBotManager получает обязательные зависимости (repo, dateCache, notifications) из него.

---

## 2. Слои и порты

**Порты** — это интерфейсы (контракты) между приложением и внешним миром: «как получить пользователей», «как отправить уведомление», «как спросить слоты у системы записи». Код use cases зависит только от портов, а не от Google Sheets или Telegram. Конкретные реализации (Sheets, Telegram, AIS API) живут в **адаптерах** и подставляются при запуске (composition root). Так можно заменить источник данных или канал уведомлений без переписывания сценариев. Подход называется «порты и адаптеры» (hexagonal architecture).

### 2.1 Схема

```
CLI (monitor, bot, health, test-*) 
        ↓
Application (startMonitor, checkUserWithCache, attemptBooking)
        ↓
Domain (User, userRotation) — без I/O
        ↑
Ports (UserRepository, DateCache, ConfigProvider, NotificationSender, VisaProvider)
        ↑
Adapters (Sheets, EnvConfig, DateCacheAdapter, Telegram, AIS/VFS)
```

### 2.2 Ключевые абстракции

- **VisaProvider:** `login`, `getAvailableDates`, `getAvailableTime`, `book`. Реализации: AIS (lib + ProviderBackedClient), VFS (VfsGlobalProviderAdapter).
- **UserRepository:** `getActiveUsers`, `getSettingsOverrides`, `getInitialData`, обновления и лог попыток. Реализация: SheetsUserRepository.
- **DateCache:** по провайдеру: `getAvailableDates`, `isDateAvailable`, `isCacheStale`, `initialize`, `updateDate`, `refreshAllDates`, `getCacheStats`. Реализация: DateCacheAdapter (обёртка над lib/dateCache.js).
- **ConfigProvider:** `getConfig(): AppConfig`. Реализация: EnvConfigProvider.
- **NotificationSender:** `send(message, chatId)`. Реализация: TelegramNotificationAdapter.
