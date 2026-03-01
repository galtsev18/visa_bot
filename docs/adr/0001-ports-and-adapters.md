# ADR-0001: Порты и адаптеры (hexagonal architecture)

**Status:** Accepted  
**Date:** 2025-03  
**Deciders:** Команда проекта

## Context

Изначально логика монитора была жёстко завязана на Google Sheets, прямой HTTP к AIS и Telegram. Добавление второго провайдера (VFS) и тестирование сценариев без реальных внешних сервисов потребовало бы дублирования и хрупких подстановок. Нужна граница между «что делает приложение» (use cases) и «как оно общается с миром» (хранилища, API, уведомления).

## Decision

Вводим слой **портов** (интерфейсы в `src/ports/`) и **адаптеров** (реализации в `src/adapters/` и при fallback в `src/lib/`). Use cases (application) зависят только от портов: UserRepository, DateCache, ConfigProvider, NotificationSender, VisaProvider. Конкретные реализации (Sheets, Telegram, AIS, VFS) создаются в **composition root** (`composition/createMonitorContext.ts`) и передаются в UserBotManager и use cases через зависимости. Команда `monitor` всегда использует composition root (из src — через реэкспорт createMonitorContext.js и tsx; из dist — скомпилированный модуль). UserBotManager получает обязательные deps (repo, dateCache, notifications) из composition root.

## Consequences

### Положительные

- Добавление нового провайдера визы = новая реализация VisaProvider + регистрация в фабрике, без правок use cases.
- Замена хранилища (например, БД вместо Sheets) = новая реализация UserRepository.
- Тесты сценариев с моками портов без реальных HTTP/Sheets/Telegram.

### Отрицательные / риски

- Часть lib остаётся с глобальным состоянием (см. TECH_DEBT, ROADMAP); уведомления о квотах Sheets по-прежнему используют глобальные initializeTelegram/setSheetsQuotaNotifier.

### Нейтральные

- Контракты портов описаны в [CONTRACTS.md](../CONTRACTS.md) и в TypeScript-интерфейсах в `src/ports/`.
