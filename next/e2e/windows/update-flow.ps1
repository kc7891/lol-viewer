<#
  In-app update, end to end, against the real installer (Windows CI).
  Usage: pwsh -File update-flow.ps1 -OldSetup <0.0.1 setup.exe> -FeedDir <dir with the 0.0.2 setup.exe + latest.yml> -OldVersion 0.0.1 -NewVersion 0.0.2
  1. install the old version (silent, per-user)  2. serve FeedDir on 127.0.0.1  3. the old app finds, downloads and installs the new
  version through its own Settings page (e2e/electron-update.spec.ts)  4. the new version is installed, running, and reports its version.
#>
param(
  [Parameter(Mandatory)] [string] $OldSetup,
  [Parameter(Mandatory)] [string] $FeedDir,
  [Parameter(Mandatory)] [string] $OldVersion,
  [Parameter(Mandatory)] [string] $NewVersion
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\lol-viewer-next\lol-viewer-next.exe'
$port = 8123
$server = $null

function Get-ExeVersion { (Get-Item $exe).VersionInfo.ProductVersion }

try {
  if (-not (Test-Path (Join-Path $FeedDir 'latest.yml'))) { throw "no latest.yml in $FeedDir" }
  Get-Content (Join-Path $FeedDir 'latest.yml') | Out-Host

  $p = Start-Process $OldSetup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "old installer exited with $($p.ExitCode)" }
  if (-not (Test-Path $exe)) { throw "app not found at $exe" }
  Write-Host "installed version: $(Get-ExeVersion)"

  $server = Start-Process node -ArgumentList @('e2e/windows/serve-feed.mjs', $FeedDir, $port) -PassThru -NoNewWindow
  Start-Sleep -Seconds 2

  $env:LOL_VIEWER_EXE = $exe
  $env:LOL_VIEWER_UPDATE_URL = "http://127.0.0.1:$port/"
  $env:LV_OLD_VERSION = $OldVersion
  $env:LV_NEW_VERSION = $NewVersion
  $env:LV_UPDATE_E2E = 'update'
  pnpm exec playwright test -c e2e/playwright.electron.config.ts electron-update.spec.ts
  if ($LASTEXITCODE -ne 0) { throw "update step failed" }

  # The silent installer replaces the files and starts the new version (--force-run). Wait for both.
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline -and (Get-ExeVersion) -ne $NewVersion) { Start-Sleep -Seconds 2 }
  if ((Get-ExeVersion) -ne $NewVersion) { throw "installed version is $(Get-ExeVersion), expected $NewVersion" }
  $running = $false
  while ((Get-Date) -lt $deadline -and -not $running) {
    $running = [bool](Get-Process lol-viewer-next -ErrorAction SilentlyContinue)
    if (-not $running) { Start-Sleep -Seconds 2 }
  }
  if (-not $running) { throw "the updated app was not restarted by the installer" }
  Write-Host "updated and restarted: $(Get-ExeVersion)"
  Get-Process lol-viewer-next -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 3

  $env:LV_UPDATE_E2E = 'verify'
  $env:LV_EXPECT_VERSION = $NewVersion
  pnpm exec playwright test -c e2e/playwright.electron.config.ts electron-update.spec.ts
  if ($LASTEXITCODE -ne 0) { throw "verify step failed" }
}
finally {
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Get-Process lol-viewer-next -ErrorAction SilentlyContinue | Stop-Process -Force
  # Leave the machine clean for the following steps.
  $dir = Split-Path $exe
  $un = Get-ChildItem (Join-Path $dir 'Uninstall*.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($un) { Start-Process $un.FullName -ArgumentList '/S' -Wait | Out-Null }
}
