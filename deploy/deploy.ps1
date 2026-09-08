# deploy.ps1 - build on Windows, ship a release to the Raspberry Pi 5, restart the
# systemd user service, health-check, and roll back automatically on failure.
#
#   ./deploy/deploy.ps1                 # build + ship + activate
#   ./deploy/deploy.ps1 -FirstDeploy    # also install + enable the systemd unit and copy .env
#   ./deploy/deploy.ps1 -SkipDashboard  # backend only (reuse the dashboard build already on disk)
#   ./deploy/deploy.ps1 -CopyEnv        # re-copy .env to the Pi (secrets change)
#
# Pi conventions: single-quoted SSH commands, tar+scp (no rsync), secrets copied
# separately with chmod 600, everything runs as `pi` under systemd --user.

param([switch]$FirstDeploy, [switch]$SkipDashboard, [switch]$CopyEnv)

# Native commands (ssh/scp) write progress to stderr; PS 5.1 would turn that into a
# terminating error under "Stop", so we rely on explicit $LASTEXITCODE checks instead.
$ErrorActionPreference = "Continue"
$Pi = "pi@raspberrypi.local"
$RemoteRoot = "/home/pi/trading-bot"
$Service = "trading-bot"
$Port = 3001

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$Sha = (git rev-parse --short HEAD 2>$null)
if (-not $Sha) { $Sha = Get-Date -Format "yyyyMMddHHmmss" }
$dirty = (git status --porcelain 2>$null)
if ($dirty) { $Sha = "$Sha-dirty-$(Get-Date -Format 'HHmmss')" }

Write-Host "==> 1/6 Building backend (tsc)..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }

if (-not $SkipDashboard) {
  Write-Host "==> 2/6 Building dashboard (vite)..." -ForegroundColor Cyan
  Push-Location "$RepoRoot\dashboard"
  npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "dashboard build failed" }
  Pop-Location
} else {
  Write-Host "==> 2/6 Skipping dashboard build" -ForegroundColor DarkGray
}
if (-not (Test-Path "$RepoRoot\dashboard\dist\index.html")) { throw "dashboard/dist is missing - run without -SkipDashboard" }

Write-Host "==> 3/6 Staging release $Sha..." -ForegroundColor Cyan
$stage = Join-Path $RepoRoot ".deploy-stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -Recurse -Force "$RepoRoot\dist" "$stage\dist"
New-Item -ItemType Directory -Force "$stage\dashboard" | Out-Null
Copy-Item -Recurse -Force "$RepoRoot\dashboard\dist" "$stage\dashboard\dist"
Copy-Item -Force "$RepoRoot\package.json" "$stage\package.json"
Copy-Item -Force "$RepoRoot\package-lock.json" "$stage\package-lock.json"
if (Test-Path "$RepoRoot\playbook") { Copy-Item -Recurse -Force "$RepoRoot\playbook" "$stage\playbook" }
Set-Content -Path "$stage\RELEASE" -Value $Sha -NoNewline

$tar = Join-Path $RepoRoot ".deploy-stage.tar.gz"
if (Test-Path $tar) { Remove-Item -Force $tar }
tar czf $tar -C $stage .
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

Write-Host "==> 4/6 Transferring to Pi..." -ForegroundColor Cyan
ssh $Pi "mkdir -p $RemoteRoot/shared/logs $RemoteRoot/releases 2>&1"
if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed" }
scp $tar "${Pi}:/tmp/trading-bot-$Sha.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "scp failed" }
$installer = Join-Path $PSScriptRoot "remote-install.sh"
# Ship the installer with LF endings regardless of how git checked it out.
$installerLf = Join-Path $RepoRoot ".deploy-remote-install.sh"
[IO.File]::WriteAllText($installerLf, ((Get-Content $installer -Raw) -replace "`r`n", "`n"))
scp $installerLf "${Pi}:$RemoteRoot/remote-install.sh"
Remove-Item -Force $installerLf

if ($FirstDeploy -or $CopyEnv) {
  Write-Host "==> 5/6 Copying .env (chmod 600)..." -ForegroundColor Cyan
  if (-not (Test-Path "$RepoRoot\.env")) { throw ".env not found in repo root" }
  scp "$RepoRoot\.env" "${Pi}:$RemoteRoot/shared/.env"
  ssh $Pi "chmod 600 $RemoteRoot/shared/.env 2>&1"
} else {
  Write-Host "==> 5/6 Keeping existing .env on Pi" -ForegroundColor DarkGray
}

if ($FirstDeploy) {
  Write-Host "==> Installing systemd user service..." -ForegroundColor Cyan
  $unitSrc = Join-Path $PSScriptRoot "$Service.service"
  $unitLf = Join-Path $RepoRoot ".deploy-$Service.service"
  [IO.File]::WriteAllText($unitLf, ((Get-Content $unitSrc -Raw) -replace "`r`n", "`n"))
  ssh $Pi "mkdir -p ~/.config/systemd/user"
  scp $unitLf "${Pi}:~/.config/systemd/user/$Service.service"
  Remove-Item -Force $unitLf
  ssh $Pi "systemctl --user daemon-reload && systemctl --user enable $Service 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "systemd enable failed" }
}

Write-Host "==> 6/6 Installing release on Pi (npm ci, activate, health-check)..." -ForegroundColor Cyan
ssh $Pi "PORT=$Port bash $RemoteRoot/remote-install.sh $Sha /tmp/trading-bot-$Sha.tar.gz 2>&1"
if ($LASTEXITCODE -ne 0) { throw "remote install failed (rolled back if a previous release existed)" }

Remove-Item -Recurse -Force $stage
Remove-Item -Force $tar

Write-Host ""
Write-Host "Done. Dashboard: http://raspberrypi.local:$Port  |  logs: ssh $Pi 'journalctl --user -u $Service -f'" -ForegroundColor Green
