# Deploy US Visa Bot on a server (autonomous, restart on crash)

The bot runs as a **systemd service**: it starts on boot and restarts automatically if it crashes. The service runs `npm start -- monitor`, which executes the app from TypeScript source via **tsx** (no separate build step). Ensure `src/`, `package.json`, and `tsconfig.json` are deployed so that `npm start` works.

## 1. Server requirements

- Linux (Debian/Ubuntu or similar)
- Node.js **20+** and npm (`package.json` `engines.node`; dependencies such as `commander` expect Node 20+)
- `.env` (only GOOGLE_SHEETS_ID and GOOGLE_CREDENTIALS_PATH) and `credentials.json` on the server; other settings in the spreadsheet **Settings** sheet

## 2. One-time setup on the server (as root)

**Important:** Run commands **one at a time** when pasting into SSH. Pasting multiple lines can cause "command not found" or merged input.

SSH in:

```bash
ssh root@YOUR_SERVER_IP
```

### 2.1 Install Node.js 20 LTS (run these one at a time)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
```

```bash
apt-get install -y nodejs
```

```bash
node -v
```

You should see v20.x. If `node` or `npm` is not found, the install didn’t complete.

If the server was previously on **Node 18**, run the same `setup_20.x` + `apt-get install -y nodejs` steps so `node -v` is **v20.x** — this removes `npm WARN EBADENGINE` (dependencies such as `commander` expect Node 20+).

### 2.2 Create app directory and copy project

On the server:

```bash
mkdir -p /opt/us-visa-bot
```

From your **local machine** (PowerShell or Git Bash, in the project folder):

```bash
scp -r src package.json package-lock.json tsconfig.json deploy root@YOUR_SERVER_IP:/opt/us-visa-bot/
scp credentials.json root@YOUR_SERVER_IP:/opt/us-visa-bot/
```

Copy `.env` to the server. Only **GOOGLE_SHEETS_ID** and **GOOGLE_CREDENTIALS_PATH** are read from .env; Telegram, VFS proxy, intervals, etc. — from the **Settings** sheet in the spreadsheet. File `deploy/.env` is a template for the server (in `.gitignore`):

```bash
scp deploy/.env root@YOUR_SERVER_IP:/opt/us-visa-bot/.env
```

**Or** from PowerShell (strips GEONIX/VFS_PROXY from local .env before copy; those go in Settings sheet):

```powershell
.\deploy\sync-env-to-server.ps1 root@YOUR_SERVER_IP
```

If you don't use `deploy/.env`, copy your project root `.env` or create `.env` from `.env.example` and fill in at least `GOOGLE_SHEETS_ID` and `GOOGLE_CREDENTIALS_PATH`.

### 2.3 On the server: install dependencies and configure

Run **one command at a time**:

```bash
cd /opt/us-visa-bot
```

```bash
npm install --omit=dev
```

Create `.env` if you didn’t copy it:

```bash
cp .env.example .env
nano .env
```

In `.env` put only `GOOGLE_SHEETS_ID` and `GOOGLE_CREDENTIALS_PATH`. Save (Ctrl+O, Enter, Ctrl+X).  
Ensure `credentials.json` is in `/opt/us-visa-bot/`. Other settings (Telegram, VFS proxy, etc.) go in the Google Sheet “Settings” tab.

**If you use VFS with proxy (Geonix):** add in the **Settings** sheet (not in .env):
- key `GEONIX_API_KEY`, value — your API key from https://geonix.com/personal/api/
- key `VFS_PROXY_COUNTRY`, value — e.g. `Russia` (country of your VFS cabinet)
Or key `VFS_PROXY_URL`, value — `http://login:password@host:port` to use a single proxy URL instead of Geonix.

### 2.4 Install the systemd service and start the bot

If you have the `deploy` folder:

```bash
cp /opt/us-visa-bot/deploy/us-visa-bot.service /etc/systemd/system/
```

**If `deploy` is missing**, create the service file manually (run this as one block, or copy the file content from the repo):

```bash
cat > /etc/systemd/system/us-visa-bot.service << 'EOF'
[Unit]
Description=US Visa Bot (monitor multi-user)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/us-visa-bot
ExecStart=/usr/bin/env npm start -- monitor
Restart=on-failure
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=us-visa-bot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
```

Then enable and start (run **one command at a time**):

```bash
systemctl daemon-reload
```

```bash
systemctl enable us-visa-bot
```

```bash
systemctl start us-visa-bot
```

```bash
systemctl status us-visa-bot
```

### 2.5 Check status and logs

```bash
systemctl status us-visa-bot
```

```bash
journalctl -u us-visa-bot -f
```

- **Status:** `active (running)` means it’s running.  
- **Restart on crash:** If the process exits with an error, systemd restarts it after 15 seconds (`RestartSec=15` in the service file).

## 3. Useful commands

| Action              | Command |
|---------------------|--------|
| Start               | `systemctl start us-visa-bot` |
| Stop                | `systemctl stop us-visa-bot` |
| Restart             | `systemctl restart us-visa-bot` |
| Status              | `systemctl status us-visa-bot` |
| Live logs           | `journalctl -u us-visa-bot -f` |
| Last 100 lines      | `journalctl -u us-visa-bot -n 100` |

### Monitor: empty sheet or no active users

If **US_users** / **VFS users** have no rows with **active=TRUE**, the process **does not exit with an error** (that used to make systemd restart in a loop). The bot **waits** and re-reads Sheets every **min(SHEETS_REFRESH_INTERVAL, 120)** seconds until at least one active user appears, then starts the normal rotation.

If the service still shows **`activating (auto-restart)`** or **`status=1/FAILURE`**, check logs: `journalctl -u us-visa-bot -n 80 --no-pager` — typical causes: missing **TELEGRAM_*** or sheets creds in **Settings** / `.env`, bad **`credentials.json`**, or Google API errors.

## 4. Updating the bot

From your PC, copy updated code (e.g. after git pull or local changes):

```bash
scp -r src package.json package-lock.json tsconfig.json root@YOUR_SERVER_IP:/opt/us-visa-bot/
ssh root@YOUR_SERVER_IP "cd /opt/us-visa-bot && npm install --omit=dev && systemctl restart us-visa-bot"
```

**Windows (PowerShell, from repo root):** `.\deploy\deploy-to-server.ps1` — same steps; optional `-Server root@OTHER_IP`. Does not overwrite `credentials.json` or `.env` on the server. Use this when your usual `ssh` to the server works from PowerShell (Windows OpenSSH).

**WSL (if the SSH key is only in Linux `~/.ssh`):** from repo root, `bash deploy/deploy-to-server.sh` (or `wsl -e bash -lc "cd .../us-visa-bot && bash deploy/deploy-to-server.sh"` from PowerShell).

Agent skill (Cursor): `.cursor/skills/deploy-us-visa-bot/SKILL.md`.

## 5. Optional: run as a dedicated user (not root)

For better security, run the service as a non-root user:

```bash
adduser --disabled-password visabot
cp -r /opt/us-visa-bot /home/visabot/
chown -R visabot:visabot /home/visabot/us-visa-bot
```

Edit the service file:

```bash
nano /etc/systemd/system/us-visa-bot.service
```

Set:

- `User=visabot`
- `WorkingDirectory=/home/visabot/us-visa-bot`

Then:

```bash
systemctl daemon-reload
systemctl restart us-visa-bot
```

Put `.env` and `credentials.json` in `/home/visabot/us-visa-bot/` and ensure only `visabot` can read them.

---

**Summary:** After following this guide, the bot on `YOUR_SERVER_IP` runs autonomously and restarts if it crashes.
