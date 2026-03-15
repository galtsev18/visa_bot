# Анализ чтения/записи Google Sheets

## Текущие паттерны

### Чтение
- **getInitialData()** — один `batchGet([Users, Cache])` ✅ оптимально.
- **readUsers()** — один `get(Users)`. Используется при refresh (getActiveUsers) и отдельно. Не заполнял `usersHeaderCache` → при следующем `getColumnIndex` лишний `get(Users!1:1)`. **Исправлено:** выставляем `usersHeaderCache` в `readUsersImpl`.
- **readAvailableDatesCache()** — один `get(Cache)`. При старте через createMonitorContext не вызывается повторно (передаём cacheEntries в dateCache.initialize). При refresh дат в dateCache — отдельные вызовы по мере необходимости.
- **readSettingsFromSheet()** — один `get(Settings)`. При refresh вызывается параллельно с getActiveUsers → 2 запроса (Users + Settings). Объединять в batchGet можно, но выигрыш небольшой.

### Запись
- **updateUserLastChecked** + **updateUserPriority** — после каждого пользователя два вызова → два `update` (или два элемента в буфере). На N пользователей = 2N записей. **Оптимизация:** один метод `updateUserAfterCheck(email, lastChecked, priority)` с одним `batchUpdate` (2 ячейки) на пользователя.
- **updateAvailableDate** — каждый вызов даёт один update/append. При flush буфера объединяются в один batchUpdate ✅ уже оптимально за счёт буфера.
- **logBookingAttempt** — один append на попытку. Редко батчится (по одной попытке за раз).

### getColumnIndex
- Вызывается в каждом updateUser* (2–4 раза на пользователя). Если `usersHeaderCache` заполнен (после getInitialData или readUsers) — запроса нет, только цикл по заголовкам. Кэш заголовков теперь заполняется и в readUsersImpl.

## Внесённые изменения
1. **readUsersImpl** — устанавливаем `s.usersHeaderCache` по первой строке, чтобы getColumnIndex не делал лишний get(1:1).
2. **updateUserAfterCheck** — новый метод: обновление last_checked и priority одним batchUpdate (один запрос на пользователя вместо двух). userBotManager вызывает его вместо Promise.all([updateUserLastChecked, updateUserPriority]).

## Возможные дальнейшие улучшения
- При refresh: batchGet([Users, Settings]) вместо двух отдельных get (один запрос вместо двух).
- Кэш индексов колонок в state (columnIndices: Record<string, number>) после первой загрузки заголовков — избавиться от повторного прохода по headers в getColumnIndex (микрооптимизация).
