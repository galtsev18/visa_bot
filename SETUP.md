# Setup Guide - Multi-User Visa Bot

This guide will help you set up the multi-user visa bot system step by step.

## Prerequisites

- Node.js 16+ installed
- A Google account
- A Telegram account
- Access to https://ais.usvisa-info.com/

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Google Sheets

#### 2.1 Create a New Google Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Copy the Spreadsheet ID from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
   - Copy the `SPREADSHEET_ID` part

#### 2.2 Create Three Sheets

Create three sheets with these exact names:
- **Users** - For user data
- **Available Dates Cache** - For caching available dates
- **Booking Attempts Log** - For logging booking attempts

The bot will automatically create headers when it runs, but you can also create them manually:

**Users Sheet Headers:**
```
email | password | country_code | schedule_id | current_date | reaction_time | date_ranges | active | last_checked | last_booked | priority
```

**Available Dates Cache Sheet Headers:**
```
date | facility_id | available | last_checked | times_available | cache_valid_until
```

**Booking Attempts Log Sheet Headers:**
```
timestamp | user_email | date_attempted | result | reason | old_date | new_date
```

#### 2.3 Set Up Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable Google Sheets API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"
4. Create Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Give it a name (e.g., "visa-bot-service")
   - Click "Create and Continue"
   - Skip role assignment, click "Done"
5. Create Key:
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key"
   - Choose "JSON" format
   - Download the JSON file
   - Save it as `credentials.json` in the project root
6. Share Spreadsheet with Service Account:
   - Open your Google Spreadsheet
   - Click "Share" button
   - Add the service account email (found in the JSON file, field `client_email`)
   - Give it "Editor" permissions
   - Click "Send"

### 3. Set Up Telegram Bot

#### 3.1 Create a Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow instructions to create a bot
4. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

#### 3.2 Get Your Chat ID

1. Run the utility command:
   ```bash
   node src/index.js get-chat-id
   ```
2. Send any message to your bot on Telegram
3. Copy the chat ID that's displayed
4. Press Ctrl+C to stop

### 4. Configure .env File

Edit the `.env` file with your actual values:

```env
# Google Sheets
GOOGLE_SHEETS_ID=your_spreadsheet_id_here
GOOGLE_CREDENTIALS_PATH=./credentials.json

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_MANAGER_CHAT_ID=your_chat_id_here

# Visa System
FACILITY_ID=134

# Monitoring (optional - defaults shown)
REFRESH_INTERVAL=3
SHEETS_REFRESH_INTERVAL=300
CACHE_TTL=60
ROTATION_COOLDOWN=30
```

**Important:**
- Remove any quotes around values
- No spaces around the `=` sign
- Make sure `credentials.json` is in the project root

### 5. Add Users to Google Sheets

In the **Users** sheet, add rows for each user:

| email | password | country_code | schedule_id | current_date | reaction_time | date_ranges | active |
|--------|----------|-------------|--------------|--------------|---------------|--------------|-----------|
| user@example.com | password123 | kz | 12345 | 2024-08-15 | 7 | [{"from":"2024-06-01","to":"2024-06-15"}] | TRUE |

**Field Descriptions:**
- `email`: User's login email for ais.usvisa-info.com
- `password`: User's password
- `country_code`: Country code (e.g., "kz", "br", "fr")
- `schedule_id`: Schedule ID from the visa appointment system
- `current_date`: Current booked appointment date (YYYY-MM-DD)
- `reaction_time`: Minimum days from today before booking (integer)
- `date_ranges`: JSON array of acceptable date ranges (human-readable)
- `active`: TRUE to enable monitoring, FALSE to disable

**Date Ranges Format (Digital format recommended):**
```json
[{"from":"2024-06-01","to":"2024-06-15"},{"from":"2024-07-01","to":"2024-07-20"}]
```

**Alternative (Human-readable format also supported):**
```json
[{"from":"June 1, 2024","to":"June 15, 2024"},{"from":"July 1, 2024","to":"July 20, 2024"}]
```

**Note:** Digital format (YYYY-MM-DD) is recommended as it's easier to work with in spreadsheets and less prone to parsing errors.

### 6. Test the System

1. Start the monitor:
   ```bash
   node src/index.js monitor
   ```

2. Check the logs to see:
   - Users being loaded from Google Sheets
   - Cache initialization
   - User rotation
   - Date checking

3. Monitor the Google Sheets:
   - Check "Available Dates Cache" for cached dates
   - Check "Booking Attempts Log" for booking attempts
   - Check "Users" sheet for updated `last_checked` timestamps

### 7. Verify Notifications

When a booking is successful, you should receive a Telegram message to the chat ID you configured.

## Troubleshooting

### Bot token errors
- Make sure token has no quotes or spaces
- Verify token with @BotFather
- Check that token is correctly set in .env

### Google Sheets errors
- Verify service account has Editor access to spreadsheet
- Check that credentials.json path is correct
- Ensure Google Sheets API is enabled

### No users found
- Check that `active` column is set to `TRUE` (not `true` or `True`)
- Verify user data format is correct
- Check sheet name is exactly "Users"

### Date parsing errors
- Use digital format: "2024-06-01" (recommended) or human-readable: "June 1, 2024"
- Ensure JSON is valid in date_ranges column
- Check date format examples in this guide

## Next Steps

Once everything is set up:
1. The bot will continuously monitor all active users
2. It will check for available dates using shared cache
3. It will automatically book appointments when valid dates are found
4. You'll receive Telegram notifications for successful bookings
5. All activity is logged in Google Sheets

## Commands Reference

```bash
# Get Telegram chat ID (one-time setup)
node src/index.js get-chat-id

# Start multi-user monitoring
node src/index.js monitor

# Single-user mode (legacy)
node src/index.js bot -c 2024-06-15

# Show help
node src/index.js --help
```
