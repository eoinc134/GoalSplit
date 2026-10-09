# Scheduled Garmin sync, run from this machine instead of Railway.
#
# Why this exists: Garmin's API started rejecting Railway's egress IP for
# ALL oauth-service calls (both the SSO login page and the lightweight
# token-refresh exchange), not just repeated login attempts - confirmed in
# production logs, not assumed. There's no fixing that from inside the
# Railway container; the Garmin-talking half of the sync has to run from a
# network Garmin doesn't block. This script runs both halves end to end:
# garmy_sync.py talks to Garmin and writes a local SQLite file, then
# import-garmin-days.js reads that file and upserts into Railway's
# Postgres over its PUBLIC connection string.
#
# Setup: copy .env.home-sync.example to .env.home-sync (repo root) and fill
# in GARMIN_EMAIL / GARMIN_PASSWORD / DATABASE_URL (the public one - see
# that file's comments). Then point Windows Task Scheduler at this script
# (Action: powershell.exe, Argument: -ExecutionPolicy Bypass -File
# "<repo-root>\scripts\home-garmin-sync.ps1").

# Deliberately NOT $ErrorActionPreference = "Stop": combined with the 2>&1
# redirection below, PowerShell 5.1 wraps every stderr LINE from a native
# exe into a terminating ErrorRecord, even purely informational output
# (hit this for real - garmy's own progress lines go to stderr and aborted
# the script despite exiting 0). Real failure detection below is explicit
# $LASTEXITCODE checks instead, which this doesn't interfere with.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot ".env.home-sync"
$LogFile = Join-Path $RepoRoot "home-sync.log"
$DbPath = Join-Path $RepoRoot "garmin-home-sync.db"
$TokenDir = Join-Path $RepoRoot "garmy-tokens-home"

# One consistent encoding for the whole log file - Add-Content and
# Tee-Object don't share a default in PowerShell 5.1, which previously
# produced a log file that was unreadable by any plain UTF-8 tool (tail,
# cat, a text editor set to UTF-8) despite looking fine inside PowerShell's
# own console.
function Write-Log($message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Run-Step($exe, $exeArgs) {
    # Capture combined output as plain strings (not PowerShell's own
    # ErrorRecord-wrapping of native stderr), log them with one consistent
    # encoding, and still surface them to the console as they'd appear
    # normally.
    $output = & $exe @exeArgs 2>&1 | ForEach-Object { $_.ToString() }
    $output | ForEach-Object { Write-Host $_ }
    $output | Add-Content -Path $LogFile -Encoding utf8
    return $LASTEXITCODE
}

if (-not (Test-Path $EnvFile)) {
    Write-Log "ERROR: $EnvFile not found - copy .env.home-sync.example and fill it in first."
    exit 1
}

# Simple KEY=VALUE loader - these are local credentials, not shared-format
# dotenv with interpolation/quoting rules, so no need for a library.
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
    }
}

if (-not $env:GARMIN_EMAIL -or -not $env:GARMIN_PASSWORD -or -not $env:DATABASE_URL) {
    Write-Log "ERROR: GARMIN_EMAIL, GARMIN_PASSWORD, and DATABASE_URL must all be set in .env.home-sync"
    exit 1
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    Write-Log "ERROR: python not found on PATH in this execution context."
    exit 1
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Log "ERROR: node not found on PATH in this execution context."
    exit 1
}

Write-Log "=== Garmin home sync starting ==="

Write-Log "Running garmy_sync.py..."
$exitCode = Run-Step $python @("$RepoRoot\apps\api\scripts\garmy_sync.py", "--db-path", $DbPath, "--token-dir", $TokenDir, "--last-days", "3")
if ($exitCode -ne 0) {
    Write-Log "garmy_sync.py exited with code $exitCode - skipping Postgres import."
    exit 1
}

Write-Log "Importing into Postgres..."
$exitCode = Run-Step $node @("$RepoRoot\apps\api\dist\scripts\import-garmin-days.js", "--db-path", $DbPath)
if ($exitCode -ne 0) {
    Write-Log "import-garmin-days.js exited with code $exitCode"
    exit 1
}

Write-Log "=== Garmin home sync finished OK ==="
exit 0
