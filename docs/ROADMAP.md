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

### 5. Документация: рекомендуемый способ запуска

- **Проблема:** из src часть путей не работает (VFS, полный composition root); легко забыть и получить «у меня локально по-другому».
- **План:** в [ARCHITECTURE.md](ARCHITECTURE.md) и корневом README явно описать: рекомендуемый способ разработки — `npm run build && npm start` или dev через tsx с единым composition root из src. Указать, когда нужна сборка (например, VFS).
- **Связано:** REQUIREMENTS § 2 (VFS и запуск из dist); п. 1.

### 6. Интеграционные тесты

- **План:** добавить в [TESTING.md](TESTING.md) целевой сценарий: интеграционный тест команды monitor с подменой всех портов (repo, dateCache, notifications, VisaProvider) моками — один цикл от CLI до use cases. Обеспечить возможность такого теста после перехода на обязательные deps и один путь инициализации.
- **Связано:** п. 1, 2; CODE_QUALITY § 7.

### 7. Поведение при перезапуске и границы масштабирования

- **Проблема:** один процесс, вертикальное масштабирование; не описаны идемпотентность операций букинга, повторные запуски при падении, блокировки при общем кэше/Sheets.
- **План:** в ARCHITECTURE или ADR кратко зафиксировать: (1) что происходит при перезапуске во время цикла (допустима ли повторная проверка тех же пользователей); (2) как избежать двойного букинга при возможном многопроцессном запуске в будущем (очередь, блокировки). Без внедрения очередей — только договорённости и границы.
- **Связано:** TECH_DEBT § 1 (один процесс).

### 8. Типизация lib и commands

- **План:** постепенная миграция `lib/` и `commands/` на TypeScript для единообразия и уменьшения расхождений между src и dist.
- **Связано:** TECH_DEBT § 1 (типизация); ADR 0002.

### 9. Неиспользуемый код

- **composition/index.ts** — barrel не импортируется; удалить или начать использовать.
- **lib/dateCache.js** — неэкспортируемые функции `isDateCached`, `getAvailableTimes`, `getStaleDates` оставить внутренними или явно экспортировать при необходимости для тестов/адаптеров.
- **Связано:** TECH_DEBT § 2.

---

## Чек-лист реализации планов

- [x] Один путь запуска monitor (composition root; fallback удалён)
- [x] UserBotManager принимает только обязательные deps (repo, dateCache, notifications)
- [x] Устранение глобального состояния в lib для dateCache (createDateCache + DI в DateCacheAdapter); sheets/telegram — в планах
- [x] ConfigProvider возвращает объединённый AppConfig (env + Settings через MergedConfigProvider)
- [ ] В ARCHITECTURE и README описан рекомендуемый способ запуска и необходимость сборки для VFS
- [ ] В TESTING.md добавлен сценарий интеграционного теста monitor с моками портов
- [ ] В ARCHITECTURE или ADR описано поведение при перезапуске и границы многопроцессного запуска
- [ ] Миграция lib/commands на TypeScript (по мере возможности)
- [ ] Решение по composition/index.ts и неэкспортируемым функциям dateCache
