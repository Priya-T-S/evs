# Shared helpers for setup.ps1 / start.ps1 / stop.ps1 (Windows PowerShell 5.1+)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$LogDir = Join-Path $Root ".logs"
New-Item -ItemType Directory -Force $LogDir | Out-Null

function Say($msg) { Write-Host "  $msg" }
function Step($msg) { Write-Host ""; Write-Host "== $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host ""; Write-Host "  [x] $msg" -ForegroundColor Red; Write-Host ""; Read-Host "Press Enter to close"; exit 1 }

function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function PgBin {
    $p = Join-Path $env:USERPROFILE "scoop\apps\postgresql\current\bin"
    if (Test-Path (Join-Path $p "pg_ctl.exe")) { return $p }
    $cmd = Get-Command pg_ctl -ErrorAction SilentlyContinue
    if ($cmd) { return Split-Path $cmd.Source }
    return $null
}

function PgData {
    $d = Join-Path $env:USERPROFILE "scoop\persist\postgresql\data"
    if (Test-Path $d) { return $d }
    return $env:PGDATA
}

function PortOpen($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function WaitFor($url, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url; if ($r.StatusCode -lt 500) { return $true } } catch { }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

function StartDatabase {
    $bin = PgBin
    if (-not $bin) { Fail "PostgreSQL is not installed. Run setup.bat first." }
    if (PortOpen 5432) { Ok "Database already running"; return }
    # Launch detached: piping pg_ctl's output would hang, because the server inherits the pipe.
    Start-Process -WindowStyle Hidden -FilePath (Join-Path $bin "pg_ctl.exe") `
        -ArgumentList "-D `"$(PgData)`" -l `"$(Join-Path $LogDir 'postgres.log')`" start"
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (PortOpen 5432) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (PortOpen 5432) { Ok "Database started" } else { Fail "The database did not start. See .logs\postgres.log" }
}

function StartRedis {
    if (PortOpen 6379) { Ok "Redis already running"; return }
    if (-not (Has "redis-server")) { Warn "Redis not installed - EcoPulse will still work (single-process mode)"; return }
    Start-Process -WindowStyle Hidden -FilePath "redis-server" -ArgumentList "--port 6379" -RedirectStandardOutput (Join-Path $LogDir "redis.log")
    Start-Sleep 1
    Ok "Redis started"
}
