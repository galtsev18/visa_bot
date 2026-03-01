# Quick Start Guide

Follow these steps to get the multi-user visa bot running:

## Prerequisites Checklist

- [ ] Node.js 16+ installed
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
   node src/index.js get-chat-id
   ```
   - Send a message to your bot
   - Copy the chat ID displayed
   - Press Ctrl+C to stop

## Step 4: Configure .env File

1. Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env
   ```

2. Edit `.env` and fill in:
   ```
   GOOGLE_SHEETS_ID=your_spreadsheet_id_here
   GOOGLE_CREDENTIALS_PATH=./credentials.json
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_MANAGER_CHAT_ID=your_chat_id_here
   FACILITY_ID=134
   ```

## Step 5: Test Google Sheets Connection

```bash
node src/index.js test-sheets
```

This will:
- Create the required sheets if they don't exist
- Test read/write access
- Show any errors if something is wrong

**Fix any errors before proceeding!**

## Step 6: Add Users to Google Sheets

1. Open your Google Spreadsheet
2. Go to the "Users" sheet
3. Add a row with user data:

| email | password | country_code | schedule_id | current_date | reaction_time | date_ranges | active |
|-------|----------|--------------|-------------|--------------|---------------|-------------|--------|
| user@example.com | password123 | kz | 12345 | 2024-08-15 | 7 | [{"from":"2024-06-01","to":"2024-06-15"}] | TRUE |

**Important fields:**
- `email`: Login email for ais.usvisa-info.com
- `password`: Login password
- `country_code`: Country code (e.g., "kz", "br")
- `schedule_id`: From the visa appointment system
- `current_date`: Current appointment date (YYYY-MM-DD)
- `reaction_time`: Minimum days from today (integer, e.g., 7)
- `date_ranges`: JSON array of acceptable dates (digital format recommended)
- `active`: Set to `TRUE` to enable monitoring

**Date Ranges Example:**
```json
[{"from":"2024-06-01","to":"2024-06-15"},{"from":"2024-07-01","to":"2024-07-20"}]
```

## Step 7: Start Monitoring

```bash
node src/index.js monitor
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
node src/index.js test-sheets

# Get Telegram chat ID
node src/index.js get-chat-id

# Start monitoring (main command)
node src/index.js monitor

# Show help
node src/index.js --help
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
- Check sheet name is exactly "Users"

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
