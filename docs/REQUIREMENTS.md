# Требования к системе

Функциональный набор и ограничения. Архитектура и структура кода — в [ARCHITECTURE.md](ARCHITECTURE.md).

**Окружение:** Node.js 18+ (см. `engines` в package.json, [DEPLOY.md](../DEPLOY.md)).

## 1. Назначение

Бот для мониторинга и автоматического переноса записей на собеседование по визе США (AIS) и задел под VFS Global. Режимы: один пользователь (CLI `bot`) и мультипользовательский пул из Google Sheets (`monitor`).

## 2. Обязательные фичи

- Мультипользовательский мониторинг из хранилища (сейчас — Google Sheets).
- Ротация пользователей с приоритетом (cooldown, lastChecked, lastBooked).
- Общий кэш дат по провайдерам с TTL и персистентностью (лист "Available Dates Cache").
- Валидация дат: раньше текущей записи, в диапазонах, не раньше (today + reaction_time).
- Букинг: слоты → выбор времени → форма; уведомления об успехе/ошибке.
- Уведомления в Telegram (успех, слот, ошибка, старт монитора, квоты Sheets).
- Поддержка нескольких провайдеров (AIS, VFS): при `user.provider === 'vfsglobal'` фабрика возвращает VfsGlobalProviderAdapter. Запуск приложения (AIS и VFS): `npm start` или `npm run dev` (оба выполняют `tsx src/index.ts`). Поле `main` в package.json указывает на `dist/index.js` для случая запуска из собранного артефакта (см. ARCHITECTURE).
- Single-user режим (legacy): один пользователь из .env, целевая/минимальная дата.

## 3. Настройки

- Интервалы: refresh, sheets refresh, cache TTL, rotation cooldown.
- AIS: request delay, rate limit backoff.
- Telegram: bot token, manager chat id.
- Опционально: 2Captcha API key, facility_id. Источник: .env + переопределение из Settings.

## 4. Утилиты и команды

- `get-chat-id` — получение Telegram chat ID.
- `test-sheets` — проверка доступа к таблице.
- `test-vfs-captcha` — отладка капчи/Cloudflare для VFS.

## 5. Надёжность

- Учёт квот Google Sheets (429, retry, уведомление).
- Обработка сетевых ошибок и rate limit (socket hang up, backoff).
- Секреты только в env/хранилище.

## 6. Требования при изменениях кода

- Сохранять обязательные фичи (разделы 2–5 выше).
- Не размывать границы слоёв (домен, приложение, порты, адаптеры — см. [ARCHITECTURE.md](ARCHITECTURE.md)).
- Держать один контур провайдеров через VisaProvider и фабрику.
- По возможности уменьшать глобальное состояние, развивать типизацию и тесты.

## 7. Чек-лист реализации

- [x] Multi-user monitor из хранилища (Sheets или другой репозиторий)
- [x] Ротация пользователей с cooldown и приоритетом
- [x] Общий кэш дат по провайдерам с TTL
- [x] Валидация дат: раньше текущей, в диапазонах, после (today + reaction_time)
- [x] Букинг через единый VisaProvider (AIS; VFS в заделе)
- [x] Уведомления Telegram (успех, слот, ошибка, старт, квоты)
- [x] Single-user режим (bot -c/-t/-m)
- [x] Настройки из .env + переопределение из Settings/хранилища
- [x] get-chat-id, test-sheets, test-vfs-captcha
- [x] Обработка квот Sheets и сетевых ошибок/backoff
- [x] Типизация (TypeScript частично), порты и адаптеры (частично), тесты домена
