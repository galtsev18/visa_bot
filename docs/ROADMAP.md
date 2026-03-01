# Планы на будущее

Улучшения по результатам ревью архитектуры. Текущее состояние и техдолг — в [ARCHITECTURE.md](ARCHITECTURE.md) и [TECH_DEBT.md](TECH_DEBT.md). Требования при изменениях — в [REQUIREMENTS.md](REQUIREMENTS.md).

---

## Высокий приоритет

### 1. Один путь запуска monitor (только composition root) — выполнено

- **Проблема:** при `npm run dev` (src) и `npm start` (dist) разное поведение: fallback инициализировал lib напрямую, без портов.
- **Сделано:** команда `monitor` всегда вызывает `createMonitorContext`; добавлен реэкспорт `composition/createMonitorContext.js` из `.ts` для запуска из src через tsx. Fallback удалён.
- **Связано:** TECH_DEBT § 1 (смешение слоёв).

### 2. Обязательные deps в UserBotManager — выполнено

- **Проблема:** UserBotManager принимал опциональные `deps` и при их отсутствии вызывал lib напрямую — два контура в одном классе.
- **Сделано:** зависимости обязательны; при отсутствии `repo`, `dateCache` или `notifications` конструктор выбрасывает ошибку. Все ветки с прямым использованием lib удалены из UserBotManager.
- **Связано:** CONTRACTS.md, тесты с моками портов.

---

## Средний приоритет

### 3. Устранение глобального состояния в lib — частично выполнено

- **Проблема:** в `lib/sheets.js`, `lib/dateCache.js`, `lib/telegram.js` — модульные `let` (sheets, cache, bot).
- **Сделано:** для кэша дат добавлен фасад `createDateCache()` в `lib/dateCache.js` (собственный Map и опция `persist`); в composition root создаётся экземпляр с `repo.updateAvailableDate` и передаётся в `DateCacheAdapter`. Глобальный кэш по-прежнему используется командами без composition root (например, bot). Sheets и Telegram пока с глобальным состоянием.
- **Связано:** TECH_DEBT § 1 (глобальное состояние).

### 4. Единый источник конфигурации — выполнено

- **Проблема:** конфиг собирался из env и листа Settings в разных местах.
- **Сделано:** порт ConfigProvider с `getConfig(): Promise<AppConfig>`; добавлен `MergedConfigProvider(envProvider, repo)`, который при getConfig() инициализирует repo, читает Settings и возвращает объединённый конфиг. В порт UserRepository добавлен метод `initialize`. Команда monitor получает конфиг только через MergedConfigProvider.
- **Связано:** CONTRACTS.md, EnvConfigProvider.

---

## Низкий приоритет

### 5. Документация: рекомендуемый способ запуска — выполнено

- **Сделано:** в [ARCHITECTURE.md](ARCHITECTURE.md) добавлен блок «Рекомендуемый способ запуска» (dev — `npm run dev`, prod и VFS — `npm run build && npm start`, когда сборка обязательна для VFS). В README указаны примеры запуска.
- **Связано:** REQUIREMENTS § 2 (VFS и запуск из dist).

### 6. Интеграционные тесты

- **План:** добавить в [TESTING.md](TESTING.md) целевой сценарий: интеграционный тест команды monitor с подменой всех портов (repo, dateCache, notifications, VisaProvider) моками — один цикл от CLI до use cases.
- **Сделано:** в TESTING.md добавлен подраздел «Целевой сценарий: интеграционный тест команды monitor» (описание шагов и моков).
- **Связано:** п. 1, 2; CODE_QUALITY § 7.

### 7. Поведение при перезапуске и границы масштабирования — выполнено

- **План:** в ARCHITECTURE или ADR кратко зафиксировать перезапуск и границы многопроцессного запуска.
- **Сделано:** в [ARCHITECTURE.md](ARCHITECTURE.md) добавлена секция «3. Перезапуск и масштабирование» (один процесс, допустимость повторной проверки при перезапуске, границы при нескольких процессах).
- **Связано:** TECH_DEBT § 1 (один процесс).

### 8. Типизация lib и commands

- **План:** постепенная миграция `lib/` и `commands/` на TypeScript для единообразия и уменьшения расхождений между src и dist.
- **Связано:** TECH_DEBT § 1 (типизация); ADR 0002.

### 9. Неиспользуемый код — частично выполнено

- **composition/index.ts** — удалён (barrel не импортировался).
- **lib/dateCache.js** — неэкспортируемые функции переименованы в `_isDateCached`, `_getAvailableTimes`, `_getStaleDates` (внутренние, линт не предупреждает).
- **Связано:** TECH_DEBT § 2.

---

## Чек-лист реализации планов

- [x] Один путь запуска monitor (composition root; fallback удалён)
- [x] UserBotManager принимает только обязательные deps (repo, dateCache, notifications)
- [x] Устранение глобального состояния в lib для dateCache (createDateCache + DI в DateCacheAdapter); sheets/telegram — в планах
- [x] ConfigProvider возвращает объединённый AppConfig (env + Settings через MergedConfigProvider)
- [x] В ARCHITECTURE и README описан рекомендуемый способ запуска и необходимость сборки для VFS
- [x] В TESTING.md добавлен сценарий интеграционного теста monitor с моками портов
- [x] В ARCHITECTURE описано поведение при перезапуске и границы многопроцессного запуска
- [ ] Миграция lib/commands на TypeScript (по мере возможности)
- [x] Решение по composition/index.ts (удалён) и неэкспортируемым функциям dateCache (префикс _)
