# Setup Guide - Multi-User Visa Bot

This guide will help you set up the multi-user visa bot system step by step.

## Prerequisites

- Node.js 18+ installed
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

The bot will automatically create headers when it runs (for a new empty sheet). For an existing sheet, add any missing columns manually. The **provider** column determines which system is used: **ais** (AIS US Visa) or **vfsglobal** (VFS Global). All parameters that vary per user are stored in this table.

**Users sheet – full column list**

| Column | Used by | Description |
|--------|---------|-------------|
| email | both | Login email (AIS or VFS site) |
| password | both | Login password |
| country_code | both | **AIS:** country code (e.g. kz, br). **VFS:** locale path (e.g. rus/en/fra) |
| schedule_id | AIS | Schedule ID from AIS |
| facility_id | AIS | (Optional) Facility ID; overrides global config when set |
| current_date | both | Current booked appointment date (YYYY-MM-DD) |
| reaction_time | both | Min days from today before accepting a slot (integer) |
| date_ranges | both | JSON array of acceptable date ranges |
| active | both | TRUE = monitor this user, FALSE = skip |
| last_checked | both | (Filled by bot) Last check timestamp |
| last_booked | both | (Filled by bot) Last successful booking date |
| priority | both | (Filled by bot) Rotation priority |
| provider | both | **ais** or **vfsglobal** – engine chooses AIS or VFS by this |
| vfs_centre | VFS | Visa centre name as in VFS dropdown (e.g. city/centre) |
| vfs_category | VFS | Visa category (e.g. type of visa) |
| vfs_subcategory | VFS | Visa subcategory |

**Users Sheet Headers (copy-paste for new sheet):**
```
email | password | country_code | schedule_id | facility_id | current_date | reaction_time | date_ranges | active | last_checked | last_booked | priority | provider | vfs_centre | vfs_category | vfs_subcategory
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
   npm start -- get-chat-id
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

In the **Users** sheet, add one row per user. Set **provider** to `ais` or `vfsglobal`; the engine uses that to choose the system. Fill only the fields that apply to the chosen provider.

**Example – AIS user:**
| email | password | country_code | schedule_id | facility_id | current_date | reaction_time | date_ranges | active | provider |
|--------|----------|-------------|--------------|-------------|--------------|---------------|--------------|--------|----------|
| user@example.com | *** | kz | 12345 | 134 | 2024-08-15 | 7 | [{"from":"2024-06-01","to":"2024-06-15"}] | TRUE | ais |

**Example – VFS user:**
| email | password | country_code | schedule_id | current_date | reaction_time | date_ranges | active | provider | vfs_centre | vfs_category | vfs_subcategory |
|--------|----------|-------------|-------------|--------------|---------------|--------------|--------|----------|------------|--------------|-----------------|
| vfs@example.com | *** | rus/en/fra | (any) | 2024-08-15 | 7 | [{"from":"2024-06-01","to":"2024-06-15"}] | TRUE | vfsglobal | Visa Application Centre | Visit | Standard |

**Field descriptions (summary):**
- `email`, `password`: Login for the site (AIS or VFS)
- `country_code`: **AIS** – e.g. kz, br. **VFS** – locale path, e.g. rus/en/fra
- `schedule_id`: **AIS** – required. **VFS** – can be empty or placeholder
- `facility_id`: **AIS** only, optional; overrides global facility when set
- `current_date`, `reaction_time`, `date_ranges`, `active`: Same for both
- `provider`: **ais** or **vfsglobal** – determines which system is used
- `vfs_centre`, `vfs_category`, `vfs_subcategory`: **VFS** only – exact text as on VFS dropdowns (which visa/centre)

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
   npm start -- monitor
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
npm start -- get-chat-id

# Start multi-user monitoring
npm start -- monitor

# Single-user mode (legacy)
npm start -- bot -c 2024-06-15

# Show help
npm start -- --help
```
