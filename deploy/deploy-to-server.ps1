# Copy app sources to production and restart the bot (systemd).
# Usage (from repo root): .\deploy\deploy-to-server.ps1
# Optional: .\deploy\deploy-to-server.ps1 -Server root@1.2.3.4
# Does not upload credentials.json or .env — see DEPLOY.md for secrets.

param(
    [Parameter(Mandatory = $false)]
    [string] $Server = "root@82.27.201.74",

    [Parameter(Mandatory = $false)]
    [string] $RemotePath = "/opt/us-visa-bot",

    [Parameter(Mandatory = $false)]
    [string] $ServiceName = "us-visa-bot"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot

$sshOpts = @(
    "-o", "ConnectTimeout=60",
    "-o", "ServerAliveInterval=15",
    "-o", "StrictHostKeyChecking=accept-new"
)

Write-Host "Deploy to ${Server}:${RemotePath} ..."
& scp @sshOpts -r src package.json package-lock.json tsconfig.json deploy "${Server}:${RemotePath}/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$remoteCmd = "cd $RemotePath && npm install --omit=dev && systemctl restart $ServiceName"
Write-Host "Remote: $remoteCmd"
& ssh @sshOpts $Server $remoteCmd
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Check: ssh $Server `"systemctl status $ServiceName`""
