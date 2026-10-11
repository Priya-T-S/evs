# One-time setup: database, Python environment, app packages, demo data.
. "$PSScriptRoot\common.ps1"

Write-Host ""
Write-Host "  EcoPulse - first-time setup (takes about 5-10 minutes)" -ForegroundColor Green

# ---------------------------------------------------------------- prerequisites
Step "Checking what is installed"
$py = $null
if (Has "py") { try { & py -3.12 --version *> $null; if ($LASTEXITCODE -eq 0) { $py = @("py", "-3.12") } } catch { } }
if (-not $py -and (Has "python")) {
    $v = (& python --version) 2>&1
    if ($v -match "Python 3\.(1[1-9])") { $py = @("python") }
}
if (-not $py) { Fail "Python 3.11 or newer is needed. Install it from https://www.python.org/downloads/ (tick 'Add to PATH'), then run setup.bat again." }
Ok "Python found"
if (-not (Has "node")) { Fail "Node.js is needed. Install the LTS version from https://nodejs.org, then run setup.bat again." }
Ok "Node.js found"
if (-not (Has "pnpm")) {
    Say "Installing pnpm (package manager)..."
    & npm install -g pnpm | Out-Null
    $env:PATH = "$env:APPDATA\npm;$env:PATH"
    if (-not (Has "pnpm")) { Fail "Could not install pnpm. Run 'npm install -g pnpm' and try again." }
}
Ok "pnpm found"

# ---------------------------------------------------------------- PostgreSQL + PostGIS + Redis
Step "Database (PostgreSQL + PostGIS) and Redis"
if (-not (PgBin) -or -not (Has "redis-server")) {
    if (-not (Has "scoop")) {
        $ans = Read-Host "  PostgreSQL/Redis are missing. Install the Scoop package manager to get them? (Y/n)"
        if ($ans -match "^[nN]") { Fail "Install PostgreSQL 16+ with PostGIS and Redis, or use 'docker compose up -d db redis', then run setup.bat again." }
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
        $env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"
    }
    if (-not (PgBin)) { Say "Installing PostgreSQL..."; & scoop install postgresql | Out-Null }
    if (-not (Has "redis-server")) { Say "Installing Redis..."; & scoop install redis | Out-Null }
}
$bin = PgBin
if (-not $bin) { Fail "PostgreSQL installation failed." }
Ok "PostgreSQL installed"

$pgRoot = Split-Path $bin
if (-not (Test-Path (Join-Path $pgRoot "share\extension\postgis.control"))) {
    Say "Adding PostGIS (maps extension) to PostgreSQL..."
    $major = ((& (Join-Path $bin "postgres.exe") --version) -replace '.*?(\d+)\..*', '$1').Trim()
    $index = "https://download.osgeo.org/postgis/windows/pg$major/"
    $page = (Invoke-WebRequest -UseBasicParsing $index).Content
    $zip = ([regex]::Matches($page, 'postgis-bundle-pg' + $major + '-[\d\.]+x64\.zip') | Select-Object -Last 1).Value
    if (-not $zip) { Fail "Could not find a PostGIS download for PostgreSQL $major at $index" }
    $tmp = Join-Path $env:TEMP "ecopulse-postgis"
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Invoke-WebRequest -UseBasicParsing ($index + $zip) -OutFile "$tmp.zip"
    Expand-Archive "$tmp.zip" -DestinationPath $tmp -Force
    $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
    foreach ($d in "bin", "lib", "share") { Copy-Item -Recurse -Force (Join-Path $src.FullName "$d\*") (Join-Path $pgRoot $d) }
    Ok "PostGIS added"
} else { Ok "PostGIS present" }

StartDatabase
StartRedis
$psql = Join-Path $bin "psql.exe"
$exists = & $psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ecopulse'"
if ($exists -ne "1") { & $psql -U postgres -c "CREATE DATABASE ecopulse;" | Out-Null; Ok "Database 'ecopulse' created" } else { Ok "Database 'ecopulse' exists" }

# ---------------------------------------------------------------- backend
Step "EcoPulse server (Python)"
if (-not (Test-Path $Python)) {
    Say "Creating Python environment..."
    & $py[0] $py[1..9] -m venv (Join-Path $Backend ".venv")
}
Say "Installing Python packages (a few minutes)..."
& $Python -m pip install -q --upgrade pip
& $Python -m pip install -q -r (Join-Path $Backend "requirements.txt")
if ($LASTEXITCODE -ne 0) { Fail "Installing Python packages failed." }
Ok "Python packages installed"

$envFile = Join-Path $Backend ".env"
if (-not (Test-Path $envFile)) {
    $secret = -join ((48..57) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    @(
        "ECOPULSE_ENV=development",
        "ECOPULSE_DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/ecopulse",
        "ECOPULSE_REDIS_URL=redis://localhost:6379/0",
        "ECOPULSE_JWT_SECRET=$secret",
        "# ECOPULSE_ANTHROPIC_API_KEY=sk-ant-...   (optional: smarter photo checks and assistant)"
    ) | Set-Content -Encoding utf8 $envFile
    Ok "Settings file created (backend\.env)"
}

$env:PYTHONUTF8 = "1"
Push-Location $Backend
& $Python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Creating database tables failed." }
Ok "Database tables ready"
$seeded = & $psql -U postgres -d ecopulse -tAc "SELECT count(*) FROM locations"
if ($seeded -eq "0" -or -not $seeded) {
    Say "Loading the demo city (Bengaluru) - about 2 minutes, needs internet..."
    & $Python -m app.seed.run
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Loading demo data failed." }
    Ok "Demo data loaded"
} else { Ok "Demo data already loaded" }
Pop-Location

# ---------------------------------------------------------------- apps
Step "Apps (citizen app + command center)"
Push-Location $Root
& pnpm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Installing app packages failed." }
Pop-Location
Ok "App packages installed"

Write-Host ""
Write-Host "  Setup complete. Double-click start.bat to open EcoPulse." -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
