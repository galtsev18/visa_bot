# Merge local .env keys (GEONIX_API_KEY, VFS_PROXY_COUNTRY) into server .env without overwriting the rest.
# Usage: .\deploy\sync-env-to-server.ps1 <server>
# Example: .\deploy\sync-env-to-server.ps1 root@YOUR_SERVER_IP
# Server .env path: tries /opt/us-visa-bot/.env then /home/visabot/us-visa-bot/.env

param(
    [Parameter(Mandatory=$true)]
    [string]$Server
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$localEnv = Join-Path $projectRoot ".env"
if (-not (Test-Path $localEnv)) {
    $localEnv = Join-Path $PSScriptRoot ".env"
}
if (-not (Test-Path $localEnv)) {
    Write-Error "Local .env not found at $localEnv"
}

$content = Get-Content $localEnv -Raw
$geonixKey = ""
$vfsCountry = ""
foreach ($line in (Get-Content $localEnv)) {
    if ($line -match '^\s*GEONIX_API_KEY=(.+)$') { $geonixKey = $Matches[1].Trim() }
    if ($line -match '^\s*VFS_PROXY_COUNTRY=(.+)$') { $vfsCountry = $Matches[1].Trim() }
}

Write-Host "Merging GEONIX_API_KEY and VFS_PROXY_COUNTRY to server $Server ..."

# Try to get current .env from server (try both paths)
$remotePaths = "/opt/us-visa-bot/.env", "/home/visabot/us-visa-bot/.env"
$serverContent = $null
foreach ($path in $remotePaths) {
    $serverContent = ssh -o BatchMode=yes -o ConnectTimeout=10 $Server "test -r $path && cat $path" 2>$null
    if ($LASTEXITCODE -eq 0 -and $serverContent) { break }
}

if (-not $serverContent) {
    Write-Host "Could not read server .env (SSH timeout/key? Run from network that can reach the server.). Pushing full deploy/.env instead."
    scp -o BatchMode=yes -o ConnectTimeout=10 (Join-Path $PSScriptRoot ".env") "${Server}:/opt/us-visa-bot/.env"
    if ($LASTEXITCODE -ne 0) { scp (Join-Path $PSScriptRoot ".env") "${Server}:/home/visabot/us-visa-bot/.env" }
    Write-Host "Done. Restart bot if needed: ssh $Server systemctl restart us-visa-bot"
    exit 0
}

# Remove old GEONIX/VFS_PROXY lines and append new ones
$lines = $serverContent -split "`n"
$filtered = $lines | Where-Object { $_ -notmatch '^\s*GEONIX_API_KEY=' -and $_ -notmatch '^\s*VFS_PROXY_COUNTRY=' }
$merged = ($filtered -join "`n").TrimEnd()
if (-not $merged.EndsWith("`n")) { $merged += "`n" }
$merged += "`n# VFS proxy (Geonix)`n"
$merged += "GEONIX_API_KEY=$geonixKey`n"
$merged += "VFS_PROXY_COUNTRY=$vfsCountry`n"

$tmpFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpFile, $merged)
scp -o BatchMode=yes -o ConnectTimeout=10 $tmpFile "${Server}:/opt/us-visa-bot/.env"
if ($LASTEXITCODE -ne 0) {
    scp $tmpFile "${Server}:/home/visabot/us-visa-bot/.env"
}
Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
Write-Host "Server .env updated. Restart bot if needed: ssh $Server systemctl restart us-visa-bot"
