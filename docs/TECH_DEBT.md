# Техдолг

Выявленные проблемы архитектуры и неиспользуемый код. Структура и слои — в [ARCHITECTURE.md](ARCHITECTURE.md). Планы по улучшению (в т.ч. по ревью архитектуры) — в [ROADMAP.md](ROADMAP.md).

---

## 1. Проблемы архитектуры

| Проблема | Где | Статус |
|----------|-----|--------|
| Дублирование AIS-пути | client.js vs providers/ais | Частично решено: при composition root используется провайдер. |
| Единый провайдер | Bot, UserBotManager | Решено: фабрика и ProviderBackedClient. |
| Глобальное состояние | sheets.js, dateCache.js, telegram.js | Актуально: `let` в модулях. |
| Смешение слоёв | UserBotManager при отсутствии deps | Частично решено: use cases вынесены; при fallback — прямой импорт lib. |
| Конфиг из двух источников | config.js + Settings | Актуально. |
| Типизация | lib, commands — JS | Частично решено: порты и application — TS. |
| Дублирование в Sheets | sheets.js | Частично решено: порт UserRepository есть. |
| Жёсткая связь с Sheets | UserBotManager | Решено на уровне порта. |
| Один процесс | monitor | Актуально: масштабирование только вертикальное. |

---

## 2. Неиспользуемый код

- **composition/index.ts** — barrel не импортируется (используется только `createMonitorContext.js`).
- **lib/dateCache.js** — функции `isDateCached`, `getAvailableTimes`, `getStaleDates` не экспортируются (внутренние).
