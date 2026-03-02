# Техдолг

Выявленные проблемы архитектуры и неиспользуемый код. Структура и слои — в [ARCHITECTURE.md](ARCHITECTURE.md). Планы по улучшению (в т.ч. по ревью архитектуры) — в [ROADMAP.md](ROADMAP.md).

---

## 1. Неиспользуемый код

- **lib/dateCache** — функции `_isDateCached`, `_getAvailableTimes`, `_getStaleDates` не экспортируются (внутренние, префикс _ для линта).

