# Stops the EcoPulse server, apps, Redis and database.
. "$PSScriptRoot\common.ps1"

Step "Stopping EcoPulse"
foreach ($port in 8000, 5173, 5174, 6379) {
    $owners = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
    foreach ($p in $owners) {
        # Kill the whole process tree (uvicorn workers, vite under cmd/pnpm).
        & taskkill.exe /PID $p /T /F 2>$null | Out-Null
    }
    if ($owners) { Ok "Stopped port $port" }
}
# Orphaned uvicorn workers can hold the port after their parent exits.
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*uvicorn*" -or $_.CommandLine -like "*multiprocessing.spawn*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$bin = PgBin
if ($bin -and (PortOpen 5432)) {
    & (Join-Path $bin "pg_ctl.exe") -D (PgData) stop -m fast | Out-Null
    Ok "Database stopped"
}
Write-Host ""
Write-Host "  EcoPulse is stopped." -ForegroundColor Green
Start-Sleep 3
