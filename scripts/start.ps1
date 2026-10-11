# Starts everything EcoPulse needs and opens it in the browser.
. "$PSScriptRoot\common.ps1"

Write-Host ""
Write-Host "  EcoPulse - starting up" -ForegroundColor Green

if (-not (Test-Path $Python)) { Fail "EcoPulse is not set up yet. Double-click setup.bat first." }
if (-not (Test-Path (Join-Path $Root "node_modules"))) { Fail "App packages are missing. Double-click setup.bat first." }

Step "Database and Redis"
StartDatabase
StartRedis

Step "EcoPulse server (API)"
if (PortOpen 8000) { Ok "Already running" }
else {
    $env:PYTHONUTF8 = "1"
    Start-Process -WindowStyle Hidden -WorkingDirectory $Backend -FilePath $Python `
        -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port 8000" `
        -RedirectStandardOutput (Join-Path $LogDir "api.log") -RedirectStandardError (Join-Path $LogDir "api-errors.log")
    if (WaitFor "http://localhost:8000/health" 60) { Ok "Server running" } else { Fail "The server did not start. See .logs\api-errors.log" }
}

Step "Apps"
# cmd.exe can only run the .cmd shim (Get-Command pnpm may return pnpm.ps1)
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { Fail "pnpm was not found. Run setup.bat first." }
foreach ($app in @(@{name = "Citizen app"; filter = "@ecopulse/mobile"; port = 5174; log = "mobile"}, @{name = "Command center"; filter = "@ecopulse/web"; port = 5173; log = "web"})) {
    if (PortOpen $app.port) { Ok "$($app.name) already running"; continue }
    Start-Process -WindowStyle Hidden -WorkingDirectory $Root -FilePath "cmd.exe" `
        -ArgumentList "/c `"`"$pnpm`" --filter $($app.filter) dev > `"$LogDir\$($app.log).log`" 2>&1`""
    if (WaitFor "http://localhost:$($app.port)" 60) { Ok "$($app.name) running" } else { Warn "$($app.name) is slow to start; see .logs\$($app.log).log" }
}

Start-Process "http://localhost:5174"
Start-Sleep 1
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "  EcoPulse is running." -ForegroundColor Green
Write-Host ""
Write-Host "    Citizen app      http://localhost:5174   (tap 'Continue as guest')"
Write-Host "    Command center   http://localhost:5173   (officer@ecopulse.dev / ecopulse-demo)"
Write-Host ""
Write-Host "  You can close this window. To shut EcoPulse down, double-click stop.bat."
Write-Host ""
Start-Sleep 8
