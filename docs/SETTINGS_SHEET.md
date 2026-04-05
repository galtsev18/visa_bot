# Лист Settings (таблица настроек)

В таблице Google Sheets должен быть лист **Settings** с двумя колонками: **key** и **value**. Все перечисленные ниже ключи читаются приложением при старте монитора и при командах (например, capture-vfs-form-requests).

## Ключи и значения по умолчанию

| key | value (пример / по умолчанию) | примечание |
|-----|-------------------------------|------------|
| TELEGRAM_BOT_TOKEN | токен от @BotFather | уведомления в Telegram |
| TELEGRAM_MANAGER_CHAT_ID | числовой chat_id | куда слать уведомления |
| FACILITY_ID | 134 | AIS facility |
| REFRESH_INTERVAL | 5 | интервал проверки (сек) |
| SHEETS_REFRESH_INTERVAL | 400 | интервал обновления пользователей из таблицы (сек) |
| CACHE_TTL | 90 | время жизни кэша дат (сек) |
| ROTATION_COOLDOWN | 45 | пауза между пользователями (сек) |
| AIS_REQUEST_DELAY_SEC | 2 | задержка между запросами AIS |
| AIS_RATE_LIMIT_BACKOFF_SEC | 30 | бэкофф при лимите AIS |
| VFS_REQUEST_DELAY_SEC | 3 | задержка для VFS |
| VFS_RATE_LIMIT_BACKOFF_SEC | 45 | бэкофф для VFS |
| **PAUSE_US_ROTATION** | **FALSE** | **чекбокс:** **TRUE** — не крутить ротацию и не логинить учётки **US (AIS)** |
| **PAUSE_VFS_ROTATION** | **FALSE** | **чекбокс:** **TRUE** — не крутить ротацию и не логинить учётки **VFS** |
| CAPTCHA_2CAPTCHA_API_KEY | ключ 2Captcha | опционально, для капчи VFS |
| **GEONIX_API_KEY** | **API-ключ Geonix** | **только в таблице, не в .env** — https://geonix.com/personal/api/ |
| **GEONIX_PROXY_LIST_TYPE** | **ipv4** | Опционально: тип списка в API Geonix (`ipv4`, `ipv6`, `mobile`, `isp`, `resident`) — см. [list-proxies](https://docs.geonix.com/api-reference/proxies/list-proxies). По умолчанию `ipv4`. |
| **VFS_PROXY_COUNTRY** | **Russia** | **только в таблице** — страна прокси для VFS (если используете Geonix) |
| **VFS_PROXY_URL** | http://login:password@host:port | **только в таблице** — опционально, подменяет Geonix |

## Перенесённые из .env в таблицу

Следующие настройки **не читаются из .env**, только из листа **Settings**:

- **GEONIX_API_KEY** — ключ API Geonix для получения прокси по стране.
- **VFS_PROXY_COUNTRY** — страна прокси (например `Russia`). По умолчанию при автоматическом добавлении ключа в лист подставляется `Russia`.
- **VFS_PROXY_URL** — полный URL прокси (например `http://user:pass@host:port`). Если задан, используется вместо Geonix.

При первом чтении Settings недостающие строки добавляются автоматически с **дефолтами из кода** (для GEONIX/VFS — пустые строки или `Russia` для страны); **из .env они не подставляются**. Ключ Geonix и при необходимости URL прокси нужно **вписать в таблицу вручную**.

## Как заполнить

1. Откройте вашу таблицу, лист **Settings**.
2. Убедитесь, что первая строка — заголовки: `key` и `value`.
3. Каждая следующая строка — один ключ: в колонке **key** — имя из таблицы выше, в колонке **value** — значение (без кавычек в ячейке).
4. После добавления GEONIX_API_KEY и VFS_PROXY_COUNTRY перезапустите бота (или дождитесь следующего обновления настроек из таблицы).
