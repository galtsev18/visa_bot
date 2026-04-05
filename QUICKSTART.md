# Quick Start Guide

Follow these steps to get the multi-user visa bot running:

## Prerequisites Checklist

- [ ] Node.js 20+ installed
- [ ] Google account
- [ ] Telegram account
- [ ] Access to https://ais.usvisa-info.com/

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Set Up Google Sheets

1. **Create a Google Spreadsheet**
   - Go to https://sheets.google.com
   - Create a new spreadsheet
   - Copy the Spreadsheet ID from the URL (the long string between `/d/` and `/edit`)

2. **Set Up Google Service Account**
   - Go to https://console.cloud.google.com/
   - Create a project (or use existing)
   - Enable "Google Sheets API"
   - Create a Service Account
   - Download the JSON key file
   - Save it as `credentials.json` in the project root
   - Share your spreadsheet with the service account email (from credentials.json) with Editor access

## Step 3: Set Up Telegram Bot

1. **Create Bot**
   - Open Telegram, search for `@BotFather`
   - Send `/newbot` and follow instructions
   - Copy the bot token

2. **Get Your Chat ID**
   ```bash
   npm start -- get-chat-id
   ```
   - Send a message to your bot
   - Copy the chat ID displayed
   - Press Ctrl+C to stop

## Step 4: Configure .env File

1. Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env
   ```

2. Edit `.env` and fill in **only**:
   ```
   GOOGLE_SHEETS_ID=your_spreadsheet_id_here
   GOOGLE_CREDENTIALS_PATH=./credentials.json
   ```
   All other settings (Telegram, VFS proxy, timings) — in the spreadsheet **Settings** sheet, see table below.

3. **Settings sheet** (in the same spreadsheet): create a sheet named **Settings**, columns **key** and **value**. Add rows (the bot can add missing keys automatically when you run it; you can also fill manually):

   | key | value |
   |-----|--------|
   | TELEGRAM_BOT_TOKEN | ваш_токен_от_BotFather |
   | TELEGRAM_MANAGER_CHAT_ID | ваш_chat_id |
   | FACILITY_ID | 134 |
   | REFRESH_INTERVAL | 5 |
   | SHEETS_REFRESH_INTERVAL | 400 |
   | CACHE_TTL | 90 |
   | ROTATION_COOLDOWN | 45 |
   | AIS_REQUEST_DELAY_SEC | 2 |
   | AIS_RATE_LIMIT_BACKOFF_SEC | 30 |
   | VFS_REQUEST_DELAY_SEC | 3 |
   | VFS_RATE_LIMIT_BACKOFF_SEC | 45 |
   | CAPTCHA_2CAPTCHA_API_KEY | (опционально, для 2Captcha) |
   | **GEONIX_API_KEY** | **(только здесь, не в .env)** ключ с https://geonix.com/personal/api/ |
   | **GEONIX_PROXY_LIST_TYPE** | (опционально) `ipv4` / `mobile` / … — см. [Geonix list-proxies](https://docs.geonix.com/api-reference/proxies/list-proxies) |
   | **VFS_PROXY_COUNTRY** | **Russia** (или другая страна кабинета VFS) |
   | **VFS_PROXY_URL** | (опционально) http://login:password@host:port — подменяет Geonix |

   Полный список ключей и значений по умолчанию: [docs/SETTINGS_SHEET.md](docs/SETTINGS_SHEET.md).

   **Отладка VFS (после настройки Settings):** `npm start -- get-vfs-login-credentials` → **`npm run list-vfs-dates`** (список доступных дат для записи; опции `--visible` / `--no-proxy`). Снять сеть: `npm start -- capture-vfs-form-requests --with-time`. Подробнее: [docs/VFS_GLOBAL.md](docs/VFS_GLOBAL.md).

## Step 5: Test Google Sheets Connection

```bash
npm start -- test-sheets
```

This will:
- Create the required sheets if they don't exist
- Test read/write access
- Show any errors if something is wrong

**Fix any errors before proceeding!**

## Step 6: Add Users to Google Sheets

1. Open your Google Spreadsheet
2. Use **two sheets** for users:
   - **US_users** — AIS (US Visa) users. Columns: email, password, country_code, schedule_id, facility_id, current_date, reaction_time, date_ranges, active, last_checked, last_booked, priority, provider. No VFS-specific columns.
   - **VFS users** — VFS Global users. Same base columns plus **vfs_centre**, **vfs_category**, **vfs_subcategory** (exact text from VFS dropdowns). Full column list in [SETUP.md](SETUP.md).
3. Add one row per user in the matching sheet. The bot loads both sheets and merges the list.

**Example (AIS — in sheet US_users):**

| email | password | country_code | schedule_id | facility_id | current_date | reaction_time | date_ranges | active | provider |
|-------|----------|--------------|-------------|-------------|--------------|---------------|-------------|--------|----------|
| user@example.com | password123 | kz | 12345 | 134 | 2024-08-15 | 7 | [{"from":"2024-06-01","to":"2024-06-15"}] | TRUE | ais |

**Important fields:**
- `email`, `password`: Login for the appointment site
- `country_code`: AIS: e.g. kz, br. VFS: locale path (e.g. rus/en/fra)
- `schedule_id`: Required for AIS; can be empty for VFS
- `current_date`, `reaction_time`, `date_ranges`, `active`: Same for both
- `provider`: **ais** or **vfs** (sheet choice also defines provider)
- VFS users go in **VFS users** sheet with **vfs_centre**, **vfs_category**, **vfs_subcategory**

**Date Ranges Example:**
```json
[{"from":"2024-06-01","to":"2024-06-15"},{"from":"2024-07-01","to":"2024-07-20"}]
```

## Step 7: Start Monitoring

```bash
npm start -- monitor
```

The bot will:
- Load users from Google Sheets
- Monitor available dates
- Book appointments automatically when valid dates are found
- Send Telegram notifications
- Log all activity to Google Sheets

## Commands Reference

```bash
# Test Google Sheets connection
npm start -- test-sheets

# Get Telegram chat ID
npm start -- get-chat-id

# Start monitoring (main command)
npm start -- monitor

# Show help
npm start -- --help
```

## Troubleshooting

### Google Sheets errors
- Verify service account has Editor access
- Check spreadsheet ID is correct
- Ensure credentials.json path is correct

### Telegram errors
- Verify bot token is correct (no quotes/spaces)
- Check chat ID is correct
- Make sure you've messaged the bot at least once

### No users found
- Check `active` column is set to `TRUE` (not `true` or `True`)
- Verify user data format is correct
- Use sheet **US_users** for AIS users and **VFS users** for VFS users (names exact)

### Date parsing errors
- Use digital format: `"2024-06-01"` not `"June 1, 2024"`
- Ensure JSON is valid in date_ranges column
- Check date format matches examples

## What Happens Next?

Once running, the bot will:
1. ✅ Continuously monitor all active users
2. ✅ Check for available dates using shared cache
3. ✅ Automatically book appointments when valid dates are found
4. ✅ Send Telegram notifications for successful bookings
5. ✅ Log all activity in Google Sheets

Monitor the logs and Google Sheets to see activity!
