# Планы на будущее

Улучшения по результатам ревью архитектуры. Текущее состояние и техдолг — в [ARCHITECTURE.md](ARCHITECTURE.md) и [TECH_DEBT.md](TECH_DEBT.md). Требования при изменениях — в [REQUIREMENTS.md](REQUIREMENTS.md).

---

## Средний приоритет

### 1. Устранение глобального состояния в lib — выполнено

- **Проблема:** в `lib/sheets.ts`, `lib/dateCache.ts`, `lib/telegram.ts` — модульные `let` (sheets, cache, bot).
- **Сделано:** dateCache — фасад `createDateCache()` + экземпляр в composition root; telegram — глобальный `bot` убран, добавлен `createTelegramSender()`, адаптер создаёт sender в конструкторе; **sheets** — всё мутабельное состояние собрано в один объект `state` (устанавливается через `initializeSheets()`), команда monitor подписывается на квоты через `repo.setQuotaNotifier()`, без прямого импорта из lib/sheets.
- **Связано:** TECH_DEBT § 1 (глобальное состояние).

---

## Низкий приоритет

### 2. Интеграционные тесты — выполнено

- **План:** интеграционный тест команды monitor с подменой портов (repo, dateCache, notifications) — один цикл от CLI до use cases.
- **Сделано:** тест `test/integration/monitor-one-cycle.test.ts`: (1) связка createDateCache + DateCacheAdapter + checkUserWithCache; (2) **UserBotManager.runOneCycle** с моками repo, dateCache, notifications — проверка «Monitor started» и «Matching Slot Found». В UserBotManager добавлен метод `runOneCycle(initialCacheEntries?, opts?)` для одного шага цикла (используется в цикле и в тестах).
- **Связано:** CODE_QUALITY § 7.

---

## Чек-лист (оставшееся)

- [x] Устранение глобального состояния в lib для **sheets** (состояние в одном объекте `state`, monitor использует `repo.setQuotaNotifier`)
