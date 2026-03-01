# Deploy US Visa Bot on a server (autonomous, restart on crash)

The bot runs as a **systemd service**: it starts on boot and restarts automatically if it crashes.

## 1. Server requirements

- Linux (Debian/Ubuntu or similar)
- Node.js 18+ and npm
- Your `.env` and `credentials.json` on the server

## 2. One-time setup on the server (as root)

**Important:** Run commands **one at a time** when pasting into SSH. Pasting multiple lines can cause "command not found" or merged input.

SSH in:

```bash
ssh root@YOUR_SERVER_IP
```

### 2.1 Install Node.js 18+ (run these one at a time)

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

### 2.2 Create app directory and copy project

On the server:

```bash
mkdir -p /opt/us-visa-bot
```

From your **local machine** (PowerShell or Git Bash, in the project folder):

```bash
scp -r src package.json package-lock.json deploy .env.example root@YOUR_SERVER_IP:/opt/us-visa-bot/
scp credentials.json root@YOUR_SERVER_IP:/opt/us-visa-bot/
```

Copy `.env` too if you have it, or create it on the server later.

### 2.3 On the server: install dependencies and configure

Run **one command at a time**:

```bash
cd /opt/us-visa-bot
```

```bash
npm install --production
```

Create `.env` if you didn’t copy it:

```bash
cp .env.example .env
nano .env
```

Set at least `GOOGLE_SHEETS_ID` and `GOOGLE_CREDENTIALS_PATH`. Save (Ctrl+O, Enter, Ctrl+X).  
Ensure `credentials.json` is in `/opt/us-visa-bot/`. Other settings can stay in the Google Sheet “Settings” tab.

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
ExecStart=/usr/bin/env node src/index.js monitor
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

## 4. Updating the bot

From your PC, copy updated code (e.g. after git pull or local changes):

```bash
scp -r src package.json root@YOUR_SERVER_IP:/opt/us-visa-bot/
ssh root@YOUR_SERVER_IP "cd /opt/us-visa-bot && npm install --production && systemctl restart us-visa-bot"
```

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
