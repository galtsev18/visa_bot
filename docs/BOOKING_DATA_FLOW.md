# Проверка данных для букинга (логика сверху до низу)

Цепочка: **таблица Users → User → Bot/Provider → attemptBooking → провайдер.book**.

---

## 1. Данные из таблицы Users

| Поле | AIS | VFS | Куда идёт |
|------|-----|-----|-----------|
| email, password | ✓ | ✓ | Bot.config, credentials, session |
| country_code | ✓ (код страны) | ✓ (локаль, напр. rus/en/fra) | Bot.config, credentials, клиент |
| schedule_id | ✓ обязателен | можно пусто | Bot.config.scheduleId, credentials |
| facility_id | ✓ опционально | не используется | user.facilityId → Bot.config.facilityId |
| current_date, last_booked | ✓ | ✓ | User, обновляются после букинга |
| reaction_time, date_ranges, active | ✓ | ✓ | Валидация дат, ротация |
| priority, last_checked | ✓ | ✓ | Ротация, обновляются монитором |
| provider | ✓ (ais) | ✓ (vfsglobal) | Выбор провайдера и таймингов |
| vfs_centre, vfs_category, vfs_subcategory | — | ✓ | credentials → VfsGlobalClient |
| rowIndex | ✓ (1-based строка) | ✓ | updateUserCurrentDate/LastBooked |

Все перечисленные поля либо участвуют в букинге/обновлении строки, либо в выборе провайдера и валидации. Для букинга данных из таблицы достаточно.

---

## 2. Цепочка до вызова book

1. **Sheets → User**  
   `getInitialData` / `getActiveUsers` читают строки, для каждой вызывается `createUser(raw)`. В `raw` попадают все колонки (в т.ч. facility_id, vfs_centre, vfs_category, vfs_subcategory). `rowIndex` выставляется по номеру строки.

2. **User → Bot и сессия**  
   В `UserBotManager.initializeUsers(user)`:
   - `facilityId = user.facilityId ?? config.facilityId ?? 134`
   - Создаётся `ProviderBackedClient(provider, { email, password, countryCode, scheduleId, facilityId, vfsCentre, vfsCategory, vfsSubcategory })`
   - Создаётся `Bot(botConfig, { client })`, в `botConfig`: scheduleId, facilityId из user/config.
   - `bot.initialize()` → `client.login(credentials)` → сессия по провайдеру (AIS: cookies; VFS: браузер + _client с vfsCentre/vfsCategory/vfsSubcategory).
   - В мапы пишутся `bots.set(user.email, bot)` и `sessions.set(user.email, sessionHeaders)`.

3. **attemptBooking(user, date)**  
   - Берутся `bot = bots.get(user.email)`, `sessionHeaders = sessions.get(user.email)`.
   - Вызов `bot.bookAppointment(sessionHeaders, date)`:
     - `time = client.checkAvailableTime(session, scheduleId, facilityId, date)` (scheduleId/facilityId из Bot.config).
     - `client.book(session, scheduleId, facilityId, date, time)`.
   - Для обновления таблицы вызываются `updateUserCurrentDate(email, newDate, timeSlot, user.rowIndex)`, `updateUserLastBooked(...)`, `logBookingAttempt(...)` — все нужные данные (email, newDate, timeSlot, rowIndex) есть у user и в аргументах.

4. **AIS**  
   `VisaHttpClient.book(headers, scheduleId, facilityId, date, time)` — все параметры приходят из Bot.config (user.scheduleId, user.facilityId ?? config.facilityId). Данных достаточно.

5. **VFS**  
   `VfsGlobalClient.book()` при наличии `_browserSession` вызывает `vfsBookFromPage(page, date, time)`. Центр/категория/подкатегория уже зашиты в клиенте (из credentials при login). Для самого вызова book достаточно date и time; данных из таблицы и сессии хватает.

---

## 3. Известные ограничения (не про недостаток данных)

- **VFS getAvailableTime:** время читается с текущей страницы (input/time-slot/fc-event-time). Если после выбора дат страница показывает календарь, перед чтением времени может понадобиться клик по конкретной дате — от этого зависит вёрстка сайта. Данные (date) для такого клика есть.
- **VFS book:** `vfsBookFromPage` сейчас выбрасывает ошибку «not yet implemented» — сценарий подтверждения/отправки формы зависит от локали и не реализован. Данные (date, time, страница) для реализации есть.

---

## 4. Итог

Для букинга **все нужные данные есть**: из таблицы (в т.ч. facility_id и VFS-поля), из конфига (facilityId по умолчанию, тайминги, Telegram) и из сессии (cookies/браузер). Ограничения — только в реализации VFS (получение времени с страницы и шаг submit), а не в полноте данных.
