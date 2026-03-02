# Диаграммы системы

C4, DFD и sequence-диаграммы в формате Mermaid. Рендер: GitHub, GitLab, VS Code (Mermaid), или [mermaid.live](https://mermaid.live).

Связано: [ARCHITECTURE.md](ARCHITECTURE.md) · [CONTRACTS.md](CONTRACTS.md) · [ADR](adr/README.md).

**Актуальность:** диаграммы соответствуют текущей архитектуре: Node 18+, встроенный fetch; доступ к Google Sheets — через `lib/sheets.ts` (доменный API: Users, Cache, Logs, Settings) и `lib/sheetsClientCore.ts` (низкоуровневый get/batchGet/update/append + quota retry); уведомления о квотах через `repo.setQuotaNotifier()`; Telegram через `TelegramNotificationAdapter`; composition root `createMonitorContext` с опциональными `opts.repo` и `opts.notifications` для тестов. Запуск: `npm start -- monitor` / `npm start -- bot`.

---

## 1. C4 Model

### 1.1 Level 1 — System Context (Контекст системы)

Кто использует систему и с какими внешними системами она взаимодействует. Подписи на связях укорочены, чтобы уменьшить наложение при рендере.

```mermaid
C4Context
    title System Context — US Visa Bot

    Person(operator, "Оператор", "Запуск monitor/bot")
    Person(user, "Пользователь визы", "Уведомления")

    System(visabot, "US Visa Bot", "Мониторинг слотов и перенос записи на собеседование")

    System_Ext(sheets, "Google Sheets", "Users, кэш дат, логи, настройки")
    System_Ext(telegram, "Telegram Bot API", "Уведомления")
    System_Ext(ais, "AIS", "Слоты и букинг")
    System_Ext(vfs, "VFS Global", "Провайдер записи (задел)")

    Rel(operator, visabot, "CLI")
    Rel(visabot, sheets, "R/W")
    Rel(visabot, telegram, "Уведомления")
    Rel(visabot, ais, "Слоты, букинг")
    Rel(visabot, vfs, "Слоты (опц.)")
    Rel(visabot, user, "Уведомления")
```

### 1.2 Level 2 — Container (Контейнеры)

Основные части приложения внутри одной процесса (Node.js).

```mermaid
C4Container
    title Container — US Visa Bot (один процесс)

    Person(operator, "Оператор")

    Container_Boundary(app, "US Visa Bot") {
        Container(cli, "CLI", "Commander", "Команды: monitor, bot, health, get-chat-id, test-*")
        Container(monitor, "Monitor Flow", "Node.js", "Ротация пользователей, кэш, букинг")
        Container(single, "Single-user Bot", "Node.js", "Режим одного пользователя (legacy)")
    }

    ContainerDb(sheets, "Google Sheets", "Google API", "Users, Cache, Logs, Settings")
    Container_Ext(telegram, "Telegram", "Bot API", "Уведомления")
    Container_Ext(ais, "AIS API", "HTTP", "Слоты, букинг")
    Container_Ext(vfs, "VFS Global", "HTTP/Puppeteer", "Слоты, букинг")

    Rel(operator, cli, "Запускает")
    Rel(cli, monitor, "monitor")
    Rel(cli, single, "bot")
    Rel(monitor, sheets, "Читает/пишет")
    Rel(monitor, telegram, "Отправляет")
    Rel(monitor, ais, "Запросы")
    Rel(monitor, vfs, "Запросы (опц.)")
```

### 1.3 Level 3 — Component (Компоненты монитора)

Внутренняя структура потока monitor: слои и зависимости.

```mermaid
C4Component
    title Component — Monitor (порты и адаптеры)

    Container_Boundary(monitor_flow, "Monitor Flow") {
        Component(cli_cmd, "monitor command", "Commander", "Точка входа → createMonitorContext → UserBotManager")
        Component(manager, "UserBotManager", "Оркестратор", "Ротация инициализация ботов цикл проверок")
        Component(uc_start, "startMonitor", "Use case", "Инициализация кэша уведомление о старте")
        Component(uc_check, "checkUserWithCache", "Use case", "Кэш рефреш валидация дат")
        Component(uc_book, "attemptBooking", "Use case", "Букинг обновление юзера лог уведомление")
        Component(domain, "User / userRotation", "Domain", "Валидация дат приоритет")
    }

    Container_Boundary(ports, "Ports") {
        Component(port_repo, "UserRepository", "Port", "")
        Component(port_cache, "DateCache", "Port", "")
        Component(port_notif, "NotificationSender", "Port", "")
        Component(port_visa, "VisaProvider", "Port", "")
        Component(port_config, "ConfigProvider", "Port", "")
    }

    Container_Boundary(adapters, "Adapters") {
        Component(adapter_sheets, "SheetsUserRepository", "Adapter", "")
        Component(adapter_cache, "DateCacheAdapter", "Adapter", "")
        Component(adapter_tg, "TelegramNotificationAdapter", "Adapter", "")
        Component(adapter_ais, "AIS ProviderBackedClient", "Adapter", "")
        Component(adapter_vfs, "VfsGlobalProviderAdapter", "Adapter", "")
        Component(adapter_config, "EnvConfigProvider", "Adapter", "")
    }

    Rel(cli_cmd, manager, "Создаёт передаёт deps")
    Rel(manager, uc_start, "При старте")
    Rel(manager, uc_check, "На каждую итерацию")
    Rel(manager, uc_book, "При найденной дате")
    Rel(manager, domain, "Ротация валидация")
    Rel(uc_check, port_cache, "getAvailableDates refreshAllDates")
    Rel(uc_check, port_visa, "через bot.client")
    Rel(uc_book, port_repo, "updateUser logBookingAttempt")
    Rel(uc_book, port_notif, "send")
    Rel(port_repo, adapter_sheets, "implements")
    Rel(port_cache, adapter_cache, "implements")
    Rel(port_notif, adapter_tg, "implements")
    Rel(port_visa, adapter_ais, "implements")
    Rel(port_visa, adapter_vfs, "implements")
```

**Пояснение:** SheetsUserRepository реализует порт UserRepository и внутри использует lib/sheets → lib/sheetsClientCore (см. [ARCHITECTURE.md](ARCHITECTURE.md) § 1.1).

---

## 2. DFD — Data Flow (поток данных)

Упрощённый поток данных при работе команды `monitor`: от конфига и хранилища до внешних систем.

```mermaid
flowchart LR
    subgraph External
        E1[Google Sheets]
        E2[Telegram]
        E3[AIS / VFS]
    end

    subgraph Process
        P1[Composition Root<br>createMonitorContext]
        P2[UserBotManager]
        P3[Check User<br>+ Cache]
        P4[Attempt Booking]
    end

    subgraph Data
        D1[Config]
        D2[Users]
        D3[Cache]
        D4[Logs]
    end

    E1 -->|users, cache, settings| P1
    P1 --> D1
    P1 --> D2
    P1 --> D3
    P2 --> P3
    P3 --> E3
    E3 --> P3
    P3 --> P4
    P4 --> E3
    P4 --> D4
    P4 --> E1
    P4 --> E2
    D2 --> P2
    D3 --> P3
```

DFD Level 1 — монитор, один цикл по пользователю:

```mermaid
flowchart TB
    subgraph Sources
        S1[Google Sheets<br>Users, Settings]
        S2[Available Dates Cache]
    end

    subgraph "Monitor Process"
        A[Load users & config]
        B[Select next user<br>rotation]
        C[Refresh cache if stale]
        D[Get available dates]
        E[Filter by user validity]
        F[Book if date found]
        G[Update user & log]
        H[Notify Telegram]
    end

    subgraph Sinks
        T1[Google Sheets<br>Updates, Logs]
        T2[Telegram]
        T3[AIS/VFS API]
    end

    S1 --> A
    A --> B
    S2 --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> T1
    G --> T2
    F --> T3
    C --> T3
```

---

## 3. Sequence — сценарии

### 3.1 Запуск monitor (composition root)

```mermaid
sequenceDiagram
    participant Op as Оператор
    participant CLI as monitor command
    participant Comp as createMonitorContext
    participant Repo as UserRepository
    participant Cache as DateCache
    participant Notif as NotificationSender
    participant Sheets as Google Sheets
    participant TG as Telegram

    Op->>CLI: npm start -- monitor
    CLI->>Comp: createMonitorContext(opts)
    alt opts.repo не передан
        Comp->>Repo: new SheetsUserRepository()
    else opts.repo передан (тесты)
        Comp->>Repo: использовать opts.repo
    end
    alt opts.notifications не передан
        Comp->>Notif: new TelegramNotificationAdapter(config)
    else opts.notifications передан (тесты)
        Comp->>Notif: использовать opts.notifications
    end
    Comp->>Repo: getInitialData()
    Repo->>Sheets: read Users, Cache
    Sheets-->>Repo: users, cacheEntries
    Repo-->>Comp: { users, cacheEntries }
    Comp->>Cache: new DateCacheAdapter(backend)
    Comp->>Cache: initialize(cacheEntries)
    Comp-->>CLI: { config, users, cacheEntries, repo, dateCache, notifications }

    CLI->>CLI: new UserBotManager(config, deps)
    CLI->>CLI: manager.initializeUsers(users)
    CLI->>Repo: setQuotaNotifier(callback)
    Note over Repo: При превышении квот Sheets — уведомление в Telegram
    CLI->>Notif: send("Monitor started...", chatId)
    Notif->>TG: sendMessage
    TG-->>Op: Уведомление
    CLI->>CLI: monitorWithRotation()
```

### 3.2 Одна итерация: проверка пользователя и букинг

```mermaid
sequenceDiagram
    participant Mgr as UserBotManager
    participant Rot as userRotation
    participant Check as checkUserWithCache
    participant Cache as DateCache
    participant Bot as Bot / VisaProvider
    participant Attempt as attemptBooking
    participant Repo as UserRepository
    participant Notif as NotificationSender
    participant AIS as AIS API

    Mgr->>Rot: getNextUser(users)
    Rot-->>Mgr: user

    Mgr->>Check: checkUserWithCache(user, deps)
    Check->>Cache: getAvailableDates(provider)
    alt cache empty or stale
        Check->>Cache: refreshAllDates(client, session, ...)
        Cache->>Bot: checkAvailableDate(...)
        Bot->>AIS: HTTP get dates
        AIS-->>Bot: dates
        Bot-->>Cache: dates
        Cache->>Repo: updateAvailableDate(...)
    end
    Check->>Cache: isDateAvailable(date)
    Check->>Check: filter user.isDateValid(date)
    Check-->>Mgr: selectedDate | null

    alt selectedDate
        Mgr->>Attempt: attemptBooking(user, date, deps)
        Attempt->>Bot: bookAppointment(session, date)
        Bot->>AIS: get time + submit form
        AIS-->>Bot: success/failure
        Bot-->>Attempt: result
        Attempt->>Repo: updateUserCurrentDate, updateUserLastBooked
        Attempt->>Repo: logBookingAttempt(...)
        Attempt->>Notif: send(success/failure message)
        Attempt-->>Mgr: true/false
    end

    Mgr->>Repo: updateUserLastChecked(user)
    Mgr->>Mgr: sleep(refreshInterval)
```

### 3.3 Single-user: команда bot (legacy)

```mermaid
sequenceDiagram
    participant Op as Оператор
    participant CLI as bot command
    participant Bot as Bot (lib/bot)
    participant Client as VisaHttpClient / ProviderBackedClient
    participant AIS as AIS API
    participant TG as Telegram

    Op->>CLI: npm start -- bot -c ... -t ...
    CLI->>Bot: new Bot(config)
    CLI->>Bot: initialize()
    Bot->>Client: login()
    Client->>AIS: POST login
    AIS-->>Client: session
    Client-->>Bot: session

    loop until target date reached
        CLI->>Bot: checkAvailableDate()
        Bot->>Client: getAvailableDates()
        Client->>AIS: GET dates
        AIS-->>Client: dates
        Client-->>Bot: dates
        alt valid date found
            Bot->>Bot: bookAppointment(date)
            Bot->>Client: getAvailableTime() then book()
            Client->>AIS: GET time, POST book
            AIS-->>Client: ok
            Bot->>TG: sendNotification(success)
            CLI->>CLI: exit 0
        end
        Bot->>Bot: sleep(refreshDelay)
    end
```

---

## 4. Ссылки

- [C4 Model](https://c4model.com/)
- [Mermaid](https://mermaid.js.org/) — синтаксис диаграмм
- [ADR](adr/README.md) — решения по архитектуре
