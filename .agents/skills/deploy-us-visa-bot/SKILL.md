---
name: deploy-us-visa-bot
description: >-
  Deploys this repo to the production Linux host via scp and restarts the us-visa-bot systemd service.
  Use when the user asks to deploy, залить на сервер, push to server, production update, or restart the bot on the server.
compatibility: Requires network access and SSH to root@82.27.201.74 (or overridden SERVER). On Windows, prefer PowerShell + OpenSSH (`%USERPROFILE%\.ssh`) — this project’s maintainer uses `deploy/deploy-to-server.ps1` successfully from PowerShell. Use `deploy-to-server.sh` from WSL/Linux only if the key is not in Windows profile.
---

# Deploy US Visa Bot to production

> **Mirror:** identical skill in `.cursor/skills/deploy-us-visa-bot/SKILL.md` (Cursor loads both `.cursor/skills/` and `.agents/skills/`).

## Target (this project)

Canonical host/path for this repo: **`.cursor/rules/deploy-server.mdc`** (workspace root).

| Item | Value |
|------|--------|
| SSH | `root@82.27.201.74` |
| Remote dir | `/opt/us-visa-bot` |
| systemd unit | `us-visa-bot` |

Do **not** use `1cbuh.igasdetection.com` for this project.

## Preferred: run a script

**Primary on Windows — PowerShell** (if `ssh root@82.27.201.74` works here, use this):

```powershell
cd <path-to-repo>   # e.g. folder where package.json lives
.\deploy\deploy-to-server.ps1
```

Optional host: `.\deploy\deploy-to-server.ps1 -Server root@OTHER_IP`

Uses **Windows OpenSSH** and keys under `%USERPROFILE%\.ssh`. The agent/Cursor environment may lack `ssh-agent` context — run the script **in your own PowerShell** where `ssh` already works.

**Fallback — WSL / Linux / macOS** (only if the key exists only under Linux `~/.ssh`):

```bash
cd /path/to/us-visa-bot
bash deploy/deploy-to-server.sh
```

Override: `SERVER=root@OTHER_IP bash deploy/deploy-to-server.sh`

Both scripts copy `src/`, `package.json`, `package-lock.json`, `tsconfig.json`, and `deploy/`, then run `npm install --omit=dev` and `systemctl restart us-visa-bot` on the server.

**Runtime note:** if Sheets have no **active=TRUE** users, `monitor` idles and polls Sheets (no systemd restart storm). See `DEPLOY.md` § “Monitor: empty sheet or no active users”.

## Manual commands (bash)

From repo root:

```bash
scp -r src package.json package-lock.json tsconfig.json deploy root@82.27.201.74:/opt/us-visa-bot/
ssh root@82.27.201.74 "cd /opt/us-visa-bot && npm install --omit=dev && systemctl restart us-visa-bot"
```

## Secrets (not copied by default deploy)

- **`credentials.json`** and **`.env`** are **not** uploaded by `deploy-to-server.ps1` (avoid overwriting production secrets). First-time setup: see `DEPLOY.md` at repository root.
- To refresh `.env` only: `.\deploy\sync-env-to-server.ps1 root@82.27.201.74` (strips Geonix/VFS proxy keys; those live in Google Sheets Settings).

## If SSH fails

- **Timeout during banner exchange:** often firewall, fail2ban, or SSH only from allowlisted IPs — fix on server or use VPN.
- **Permission denied (publickey) in PowerShell:** run `ssh-add` for your key, or ensure the same key exists in `%USERPROFILE%\.ssh`. If the key exists only in **WSL**, use `deploy/deploy-to-server.sh` from WSL, or copy the public key setup to Windows OpenSSH.
- **Agent automated deploy fails but your PowerShell works:** run `.\deploy\deploy-to-server.ps1` locally — Cursor often has no SSH agent/session.

## After deploy

- Check: `ssh root@82.27.201.74 "systemctl status us-visa-bot"`
- Logs: `ssh root@82.27.201.74 "journalctl -u us-visa-bot -n 80 --no-pager"`

## Full reference

- `DEPLOY.md` at repository root — first install, systemd, optional non-root user.
