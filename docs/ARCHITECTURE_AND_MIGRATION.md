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
- **Опционально:** Puppeteer + stealth (для VFS/Cloudflare)

### 1.3 Структура кода (упрощённо)

```
src/
├── index.js              # CLI: команды monitor, bot, get-chat-id, test-sheets, test-vfs-captcha
├── commands/
│   ├── monitor.js        # Точка входа multi-user: Sheets → UserBotManager
│   ├── bot.js            # Точка входа single-user (legacy)
│   ├── get-chat-id.js    # Утилита Telegram
│   ├── test-sheets.js    # Проверка доступа к таблице
│   └── test-vfs-captcha.js
└── lib/
    ├── config.js         # .env + валидация
    ├── user.js           # Модель пользователя (даты, диапазоны, валидация)
    ├── userBotManager.js # Оркестрация: пул юзеров, кэш, ротация, букинг
    ├── userRotation.js   # Выбор следующего юзера по приоритету
    ├── bot.js            # Один бот: login, checkAvailableDate, bookAppointment (только AIS)
    ├── client.js         # VisaHttpClient — AIS HTTP (login, dates, times, book)
    ├── dateCache.js      # In-memory + синхронизация с листом "Available Dates Cache"
    ├── dateParser.js     # Парсинг дат и диапазонов (chrono)
    ├── sheets.js         # Google Sheets: Users, Cache, Logs, Settings + квоты
    ├── telegram.js       # Инициализация + sendNotification + форматтеры сообщений
    ├── utils.js          # sleep, log, isSocketHangupError, formatErrorForLog
    ├── captcha.js        # 2Captcha (image, reCAPTCHA, Turnstile)
    ├── browserCloudflare.js  # (если есть) обход Cloudflare через браузер
    └── providers/
        ├── base.js       # Интерфейс VisaProvider (JSDoc)
        ├── ais.js        # AisProvider — обёртка над VisaHttpClient
        └── vfsglobal.js  # VfsGlobalClient (не используется в Bot/UserBotManager)
```

### 1.4 Выявленные проблемы архитектуры

| Проблема | Где | Описание |
|----------|-----|----------|
| **Дублирование AIS-логики** | `client.js` vs `providers/ais.js` | Bot использует только `VisaHttpClient`; провайдер AIS не используется в основном потоке. Добавление VFS потребует правок в Bot/UserBotManager. |
| **Нет единого провайдера** | Bot, UserBotManager | В коде есть `user.provider`, кэш по провайдерам, но Bot жёстко завязан на `client.js` (AIS). Нет фабрики/регистра провайдеров. |
| **Глобальное состояние** | sheets.js, dateCache.js, telegram.js, config | Модули с `let sheets`, `let cache`, `let telegramToken` усложняют тесты и переиспользование. |
| **Смешение слоёв** | UserBotManager, monitor.js | Оркестрация, работа с кэшем, Sheets, Telegram и доменная логика (букинг) в одном месте. |
| **Конфиг из двух источников** | config.js + Settings sheet | .env и лист Settings смешиваются после старта; валидация размазана (validateEnvForSheets / validateMultiUserConfig). |
| **Нет типизации** | Весь проект | Только JSDoc местами; нет TypeScript — сложнее рефакторинг и контракты. |
| **Нет тестов** | package.json | `"test": "echo \"Error: no test specified\""` — нет юнит/интеграционных тестов. |
| **Повторяющаяся работа с Sheets** | sheets.js | Много дублирования: getColumnIndex, поиск по email, обновление ячеек; нет абстракции "репозиторий". |
| **Жёсткая связь с Google Sheets** | UserBotManager | Пользователи и настройки только из Sheets; нельзя подменить источник (например, БД или API) без правок по всему коду. |
| **Один процесс на всё** | monitor | Один цикл: ротация пользователей, кэш, букинг, уведомления. Масштабирование только вертикальное. |

---

## 2. Функциональный набор (что сохраняем при переходе)

### 2.1 Обязательные фичи
- **Мультипользовательский мониторинг** из внешнего хранилища (сейчас — Google Sheets).
- **Ротация пользователей** с приоритетом (cooldown, lastChecked, lastBooked).
- **Общий кэш дат** по провайдерам с TTL и опциональной персистентностью (сейчас — лист "Available Dates Cache").
- **Валидация дат на пользователя:** раньше текущей записи, в диапазонах, не раньше (today + reaction_time).
- **Букинг:** проверка слотов → выбор времени → отправка формы; уведомления об успехе/ошибке.
- **Уведомления в Telegram** (успех, слот найден, ошибка, старт монитора, квоты Sheets).
- **Поддержка нескольких провайдеров** (AIS сейчас; VFS — в заделе): один контур с разными бэкендами.
- **Single-user режим** (legacy): один пользователь из .env, целевая/минимальная дата, выход по достижению цели.

### 2.2 Настройки (сохраняем семантику)
- Интервалы: refresh (между проверками), sheets refresh, cache TTL, rotation cooldown.
- AIS: request delay, rate limit backoff.
- Telegram: bot token, manager chat id.
- Опционально: 2Captcha API key, facility_id и т.д.
- Источник настроек: .env + при необходимости переопределение из хранилища (как сейчас Settings sheet).

### 2.3 Утилиты и команды
- `get-chat-id` — получение Telegram chat ID.
- `test-sheets` — проверка доступа к таблице/хранилищу.
- `test-vfs-captcha` — отладка капчи/Cloudflare для VFS (оставить в текущем виде или вынести в «лабораторию»).

### 2.4 Безопасность и надёжность
- Учёт квот Google Sheets (429, retry, уведомление).
- Обработка сетевых ошибок и rate limit (socket hang up, backoff).
- Никаких секретов в коде; конфиг из env/хранилища.

---

## 3. Целевая архитектура (взрослая и современная)

### 3.1 Принципы
- **Чёткие слои:** домен → применение (use cases) → инфраструктура (HTTP, Sheets, Telegram, кэш).
- **Зависимости внутрь:** домен не знает про Telegram/Sheets; адаптеры реализуют интерфейсы (порты).
- **Один вход в приложение:** конфиг и контейнер зависимостей в одном месте (DI).
- **Типизация:** TypeScript для контрактов и безопасного рефакторинга.
- **Тестируемость:** домен и сценарии без реальных HTTP/Sheets/Telegram; интеграционные тесты опционально.

### 3.2 Слои (высокоуровнево)

```
┌─────────────────────────────────────────────────────────────────┐
│  CLI (Commander) → команды: monitor, bot, get-chat-id, test-*   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Application (Use Cases)                                         │
│  - StartMonitor, CheckUser, BookAppointment, RefreshCache, ...    │
│  - Используют только порты (интерфейсы)                          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Domain                                                          │
│  - User, DateRange, Slot, ProviderId                             │
│  - Валидация дат, правила букинга                                │
│  - Без I/O                                                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Ports (интерфейсы)                                              │
│  - UserRepository, ConfigProvider, DateCache, NotificationSender│
│  - VisaProvider (login, getAvailableDates, getAvailableTime,    │
│                  book)                                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│  Adapters (инфраструктура)                                       │
│  - SheetsUserRepository, EnvConfigProvider, InMemoryDateCache,  │
│    SheetsDateCache, TelegramNotificationSender                   │
│  - AisVisaProvider (VisaHttpClient), VfsGlobalVisaProvider        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Ключевые абстракции

- **VisaProvider (порт)**  
  `login(credentials) → session`, `getAvailableDates(session, scheduleId, facilityId)`, `getAvailableTime(...)`, `book(...)`.  
  Реализации: AIS (текущий client.js), VFS Global.

- **UserRepository (порт)**  
  `getActiveUsers()`, `updateLastChecked(email, ts)`, `updateCurrentDate(email, date, time)`, `updateLastBooked(...)`, `logBookingAttempt(attempt)`.  
  Реализация: Google Sheets (текущая логика sheets.js), при желании — PostgreSQL/API.

- **DateCache (порт)**  
  По провайдеру: `getAvailableDates(provider)`, `isStale(provider, date, ttl)`, `set(date, available, times, ttl, provider)`, `refreshDates(session, scheduleId, facilityId, provider, options)`.  
  Реализации: in-memory; in-memory + персистентность в Sheets (как сейчас).

- **ConfigProvider (порт)**  
  `getConfig(): AppConfig` — всё, что нужно приложению (интервалы, Telegram, facility, AIS delays и т.д.).  
  Реализация: .env + опционально переопределение из UserRepository/Settings.

- **NotificationSender (порт)**  
  `send(message, chatId)` или `notify(event, payload)`.  
  Реализация: Telegram.

- **User (домен)**  
  Уже есть хорошая модель: email, currentDate, dateRanges, reactionTime, isDateValid(), needsAppointment(). Добавить: ProviderId (enum/string).

- **Rotation (домен/приложение)**  
  Выбор следующего пользователя по приоритету — чистый алгоритм по списку User; без прямого доступа к Sheets.

### 3.4 Конфигурация и запуск
- Один **AppConfig** (интерфейс): все числовые и строковые настройки.
- Сборка конфига: сначала .env, потом при старте monitor — переопределение из Settings (или из того же репозитория).
- **Composition root** (один файл или папка `composition/`): создаём все адаптеры и передаём в use cases. Так проще подменять реализации и тестировать.

### 3.5 Технологии для новой версии
- **TypeScript** — строгая типизация, интерфейсы для портов.
- **Структура папок:** по слоям (domain, application, adapters, cli) или по фичам (monitor, booking, notifications) — на выбор; главное — зависимости только внутрь (к домену).
- **Тесты:** Jest (или Vitest) — юнит для домена и сценариев (с моками портов), при необходимости интеграционные с тестовой таблицей/фейковым Telegram).
- **Линтер/форматтер:** ESLint + Prettier; опционально strict TypeScript.
- **Логирование:** структурированный логгер (pino или winston) вместо `console.log` для продакшена и уровней (debug/info/warn/error).

---

## 4. План перехода (поэтапно)

Цель: не переписывать всё за один раз, а шагами выйти на целевую архитектуру, сохраняя работоспособность.

### Фаза 0: Подготовка (без смены поведения)
1. **Добавить TypeScript** в проект (tsconfig, компиляция или ts-node): сначала разрешить .ts рядом с .js, переносить по одному модулю.
2. **Ввести линтер и форматтер** (ESLint, Prettier), CI check.
3. **Описать контракты** в виде TypeScript-интерфейсов (VisaProvider, UserRepository, DateCache, NotificationSender, AppConfig) в отдельном файле/папке `contracts/` или `ports/` — пока без смены кода, только типы и JSDoc.

### Фаза 1: Выделение портов и адаптеров
4. **DateCache:** вынести интерфейс DateCache; текущую реализацию обернуть в адаптер (InMemory + Sheets persistence). UserBotManager и dateCache вызывать только через интерфейс.
5. **NotificationSender:** интерфейс с методом `send(text, chatId)`; текущий telegram.js — реализация адаптера. Все вызовы sendNotification заменить на вызов порта.
6. **Config:** интерфейс AppConfig + провайдер, который читает .env и при старте monitor — лист Settings. Вся валидация в одном месте при построении конфига.

### Фаза 2: Репозиторий пользователей и провайдеры
7. **UserRepository:** интерфейс (getActiveUsers, updateLastChecked, updateCurrentDate, updateLastBooked, logBookingAttempt, readSettings). Реализация SheetsUserRepository — перенос текущей логики из sheets.js (Users, Logs, Settings). Команда monitor получает пользователей и настройки только через репозиторий.
8. **Единый VisaProvider в контуре букинга:** Bot или новый сервис BookingService должен зависеть от VisaProvider, а не от VisaHttpClient. Фабрика по `providerId`: 'ais' → AisProvider (обёртка над VisaHttpClient), 'vfsglobal' → VfsGlobalProvider. UserBotManager и single-user команда вызывают только провайдер; инициализация сессии через provider.login(credentials).

### Фаза 3: Use cases и очистка
9. **Сценарии в виде классов/функций:** StartMonitor (загрузка юзеров, инициализация кэша, отправка "Monitor started"), CheckUserWithCache (обновление кэша при необходимости, выбор валидной даты), AttemptBooking (букинг + обновление юзера и логов + уведомление). UserBotManager превращается в тонкий оркестратор, вызывающий эти сценарии и Rotation.
10. **Убрать глобальное состояние:** все адаптеры создаются в composition root и передаются в use cases (через конструктор или аргументы). В тестах подставляются моки.

### Фаза 4: Домен и тесты
11. **Домен в чистые модули:** User, date validation, rotation logic — без импортов из adapters. Тесты на User.isDateValid, rotation order.
12. **Юнит-тесты:** домен, сценарии (с моками репозитория, кэша, провайдера, уведомлений). Интеграционные тесты — по желанию (например, test-sheets с тестовой таблицей).

### Фаза 5: Улучшения инфраструктуры
13. **Логирование:** заменить log() на структурированный логгер с уровнями.
14. **Обработка ошибок:** единый формат ошибок приложения, обработка на границе CLI (не падать с сырым stack в продакшене).
15. **Опционально:** health endpoint, метрики (сколько проверок, букингов в час) — если планируется мониторинг процесса.

---

## 5. Чек-лист фич при переносе

- [ ] Multi-user monitor из хранилища (Sheets или другой репозиторий)
- [ ] Ротация пользователей с cooldown и приоритетом
- [ ] Общий кэш дат по провайдерам с TTL
- [ ] Валидация дат: раньше текущей, в диапазонах, после (today + reaction_time)
- [ ] Букинг через единый VisaProvider (AIS, затем VFS)
- [ ] Уведомления Telegram (успех, слот найден, ошибка, старт, квоты)
- [ ] Single-user режим (bot -c/-t/-m)
- [ ] Настройки из .env + переопределение из Settings/хранилища
- [ ] get-chat-id, test-sheets, test-vfs-captcha
- [ ] Обработка квот Sheets и сетевых ошибок/backoff
- [ ] Типизация (TypeScript), порты и адаптеры, тесты

---

## 6. Итог

Текущий проект уже содержит полезную бизнес-логику (пул пользователей, кэш, ротация, букинг AIS, уведомления, работа с Sheets). При переписывании важно:

1. **Сохранить этот набор фич** и семантику настроек.
2. **Ввести чёткие границы:** домен, use cases, порты, адаптеры — чтобы можно было менять источник пользователей, провайдера визы или канал уведомлений без переписывания ядра.
3. **Унифицировать работу с провайдерами** через один интерфейс VisaProvider и фабрику по `providerId`.
4. **Убрать глобальное состояние** и заменить его на явные зависимости (DI в composition root).
5. **Добавить TypeScript и тесты** для безопасной эволюции.

План перехода разбит на фазы так, чтобы после каждого шага приложение оставалось рабочим, а архитектура постепенно приближалась к целевой. Начинать разумно с Фазы 0 и 1 (типы, порты для кэша и уведомлений, конфиг), затем репозиторий и провайдеры (Фаза 2), затем вынос сценариев и очистка (Фаза 3–4).
