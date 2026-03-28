# Copy local .env to server. VFS proxy (GEONIX_API_KEY, VFS_PROXY_COUNTRY, VFS_PROXY_URL) is read from the Settings sheet only — not from .env.
# Usage: .\deploy\sync-env-to-server.ps1 <server>
# Example: .\deploy\sync-env-to-server.ps1 root@YOUR_SERVER_IP
# Server path: /opt/us-visa-bot/.env or /home/visabot/us-visa-bot/.env

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

$lines = Get-Content $localEnv
$filtered = $lines | Where-Object {
    $_ -notmatch '^\s*GEONIX_API_KEY=' -and
    $_ -notmatch '^\s*VFS_PROXY_COUNTRY=' -and
    $_ -notmatch '^\s*VFS_PROXY_URL='
}
$content = $filtered -join "`n"
if ($content -and -not $content.EndsWith("`n")) { $content += "`n" }
$content += "`n# VFS proxy: set in Google Sheet ""Settings"" (GEONIX_API_KEY, VFS_PROXY_COUNTRY or VFS_PROXY_URL).`n"

$tmpFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmpFile, $content)

Write-Host "Copying .env to $Server (without GEONIX/VFS_PROXY — those go in Settings sheet) ..."
# PS 7.2+: Stop + native exit code can throw before $LASTEXITCODE is checked — relax for scp only so fallback path runs.
$prevEap = $ErrorActionPreference
$prevNative = $null
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $prevNative = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
}
try {
    $ErrorActionPreference = "Continue"
    scp -o BatchMode=yes -o ConnectTimeout=10 $tmpFile "${Server}:/opt/us-visa-bot/.env"
    if ($LASTEXITCODE -ne 0) {
        scp $tmpFile "${Server}:/home/visabot/us-visa-bot/.env"
    }
} finally {
    $ErrorActionPreference = $prevEap
    if ($null -ne $prevNative) {
        $PSNativeCommandUseErrorActionPreference = $prevNative
    }
}
Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
Write-Host "Done. Ensure GEONIX_API_KEY and VFS_PROXY_COUNTRY are in the Settings sheet. Restart: ssh $Server systemctl restart us-visa-bot"
