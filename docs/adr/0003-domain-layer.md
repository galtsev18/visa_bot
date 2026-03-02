# ADR 0003: Выделение слоя domain

## Статус

Принято.

## Контекст

Доменная логика (User, ротация пользователей, валидация дат) находилась в `lib/` вместе с инфраструктурой (sheets, telegram, client). Требовалось явно выделить слой домена: сущности и правила без I/O, чтобы границы слоёв соответствовали целевой архитектуре (ROADMAP п. 3).

## Решение

- Введён каталог **`src/domain/`** с модулями без зависимостей от application, adapters и lib (кроме порта `User` и типов).
- **domain/dateUtils.ts** — чистые утилиты: `ParsedDateRange`, `isDateInRanges`, `formatDate`. Без I/O.
- **domain/User.ts** — класс `User`, реализующий порт `ports/User`. Принимает уже распарсенные данные (`UserConstructorInput` с `dateRanges: ParsedDateRange[]`). Валидация дат и `toObject()` — в домене.
- **domain/userRotation.ts** — `getNextUser`, `updateUserPriority`, `getRotationStats`. Логика без I/O; логирование выбора пользователя выполняет вызывающий код (UserBotManager).
- **lib/user.ts** — фабрика **createUser(raw: RawUserInput): User**: парсит `date_ranges` через `lib/dateParser`, строит `UserConstructorInput`, создаёт `new User(...)` из domain. Реэкспорт `User` из domain для обратной совместимости импортов.
- **lib/dateParser.ts** — по-прежнему парсит строки/JSON (chrono-node, logger); тип `ParsedDateRange` импортируется из domain; реэкспорт `isDateInRanges`, `formatDate` из domain для совместимости.
- **lib/userRotation.ts** удалён; импорты переведены на `domain/userRotation`.

Порт **ports/User.ts** не менялся; domain-класс его реализует.

## Последствия

- Домен не импортирует из application, adapters, lib (только из ports для интерфейса User).
- Тесты домена (user.test.ts, userRotation.test.ts) используют `createUser()` из lib и импортируют ротацию из domain.
- ARCHITECTURE.md и дерево исходников обновлены: добавлен блок `domain/`, в lib остаётся только фабрика и инфраструктура.
