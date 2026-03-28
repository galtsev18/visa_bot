# Agent / Cursor instructions

This repo includes an **Agent skill** for production deploy and restart:

- **Name:** `deploy-us-visa-bot`
- **Paths:** `.cursor/skills/deploy-us-visa-bot/SKILL.md` and `.agents/skills/deploy-us-visa-bot/SKILL.md` (same content; Cursor discovers both).

Use it when the user asks to deploy, «залить на сервер», or restart the bot on the server. **Primary:** `deploy/deploy-to-server.ps1` in PowerShell (maintainer uses this). **Fallback:** `deploy/deploy-to-server.sh` on WSL/Linux. Cursor agent may lack SSH session — user should run the script locally if `ssh` works in their terminal only.

**Cursor UI:** Settings → Rules → **Skills** (under Agent Decides) lists discovered project skills after reload.

Server defaults: see `.cursor/rules/deploy-server.mdc`.
