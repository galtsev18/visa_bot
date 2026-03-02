# Техдолг

Выявленные проблемы архитектуры и неиспользуемый код. Структура и слои — в [ARCHITECTURE.md](ARCHITECTURE.md). Планы по улучшению (в т.ч. по ревью архитектуры) — в [ROADMAP.md](ROADMAP.md).

---

## 1. lib/sheets.ts

- Файл разбит на зоны (см. комментарии в начале и секции 1–8). Низкоуровневый API вынесен в `lib/sheetsClientCore.ts` (get/batchGet/update/append + quota retry); `sheets.ts` использует его для доменных операций (Users, Cache, Logs, Settings).

## 2. Неиспользуемый код

- **lib/dateCache** — функции `_isDateCached`, `_getAvailableTimes`, `_getStaleDates` не экспортируются (внутренние, префикс _ для линта).

