#!/usr/bin/env bash
# Deploy sources and restart systemd service. Use from WSL/Git Bash/macOS/Linux when the SSH key lives in ~/.ssh there.
# Usage (repo root): bash deploy/deploy-to-server.sh
# Override: SERVER=root@1.2.3.4 bash deploy/deploy-to-server.sh
# Does not upload credentials.json or .env — see DEPLOY.md.

set -euo pipefail

SERVER="${SERVER:-root@82.27.201.74}"
REMOTE_PATH="${REMOTE_PATH:-/opt/us-visa-bot}"
SERVICE="${SERVICE:-us-visa-bot}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SSH_OPTS=(-o ConnectTimeout=60 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new)

echo "Deploy to ${SERVER}:${REMOTE_PATH}/ ..."
scp "${SSH_OPTS[@]}" -r src package.json package-lock.json tsconfig.json deploy "${SERVER}:${REMOTE_PATH}/"

remote_cmd="cd ${REMOTE_PATH} && npm install --omit=dev && systemctl restart ${SERVICE}"
echo "Remote: ${remote_cmd}"
ssh "${SSH_OPTS[@]}" "${SERVER}" "${remote_cmd}"

echo "Done. Check: ssh ${SERVER} \"systemctl status ${SERVICE}\""
