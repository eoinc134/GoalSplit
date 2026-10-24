# Refreshes the local research snapshot (docker compose service `research-db`,
# port 5434) from production. Read-only on Railway's side: pg_dump only reads.
#
# - Uses the public Railway connection string from .env.railway (copy
#   .env.railway.example). Falls back to the legacy .env.home-sync if present.
# - Skips strava_tokens' rows, so no OAuth tokens are copied off production.
# - Replaces the whole snapshot each run, so the result is an exact copy of
#   production at that moment.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\research-snapshot.ps1

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot ".env.railway"
if (-not (Test-Path $EnvFile)) { $EnvFile = Join-Path $RepoRoot ".env.home-sync" }

if (-not (Test-Path $EnvFile)) {
    Write-Error ".env.railway not found - copy .env.railway.example and set DATABASE_URL first."
    exit 1
}

$SourceUrl = (Get-Content $EnvFile | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
if (-not $SourceUrl) {
    Write-Error "DATABASE_URL is not set in $EnvFile."
    exit 1
}

Push-Location $RepoRoot
try {
    docker compose --profile research up -d research-db
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        docker compose exec -T research-db pg_isready -U goalsplit *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { Write-Error "research-db did not become ready."; exit 1 }

    # Dump and restore both run inside the container (its pg_dump matches
    # Railway's Postgres 18), streaming straight from one to the other. The
    # script is copied in as a file: PowerShell 5.1 strips embedded double
    # quotes from native-command arguments, and prefixes piped stdin with a
    # byte-order mark the shell can't parse.
    $restore = @'
set -e
psql -q -U "$POSTGRES_USER" -d goalsplit_snapshot -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" 2> /dev/null
pg_dump --no-owner --no-privileges --exclude-table-data=strava_tokens "$SRC_URL" | psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d goalsplit_snapshot > /dev/null
psql -U "$POSTGRES_USER" -d goalsplit_snapshot -Atc "SELECT 'activities: ' || count(*) FROM activities UNION ALL SELECT 'activity_metrics: ' || count(*) FROM activity_metrics UNION ALL SELECT 'garmin_days: ' || count(*) FROM garmin_days"
'@
    $tmp = Join-Path ([IO.Path]::GetTempPath()) "goalsplit-research-restore.sh"
    [IO.File]::WriteAllText($tmp, ($restore -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))
    docker compose cp $tmp research-db:/tmp/restore.sh
    Remove-Item $tmp
    docker compose exec -T -e SRC_URL="$SourceUrl" research-db sh /tmp/restore.sh
    if ($LASTEXITCODE -ne 0) { Write-Error "Snapshot failed."; exit $LASTEXITCODE }
    Write-Host "Snapshot refreshed: postgresql://goalsplit:***@localhost:5434/goalsplit_snapshot"
}
finally {
    Pop-Location
}
