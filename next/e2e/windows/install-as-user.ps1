<#
  Installs, launches and uninstalls the app as a freshly created STANDARD
  (non-admin) local user, the way most players run it.
  Usage: pwsh -File install-as-user.ps1 -Setup <setup.exe> -UserName <name>

  How the user is driven: the profile is created first by a trivial logon
  (cmd.exe), the setup is staged in a folder the user can write, and every
  process gets that user's own profile folders explicitly. An earlier version
  that launched the installer directly with Start-Process -Credential got
  "exit code 0 but nothing installed"; the exact cause was not isolated (the
  environment-inheritance guess turned out wrong: a plain launch already sees
  the user's own USERPROFILE), so keep this sequence as is.
#>
param(
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $UserName
)
$ErrorActionPreference = 'Stop'
$stage = 'C:\Users\Public\lv-setup'

$plain = 'Lv!' + [guid]::NewGuid().ToString('N').Substring(0, 16)
$pw = ConvertTo-SecureString $plain -AsPlainText -Force
New-LocalUser -Name $UserName -Password $pw -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -Group 'Users' -Member $UserName
if ((Get-LocalGroupMember -Group 'Administrators').Name -match [regex]::Escape($UserName)) { throw "test user must not be an admin" }

New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -LiteralPath $Setup (Join-Path $stage 'setup.exe') -Force
icacls $stage /grant "${UserName}:(OI)(CI)M" | Out-Null

$script:ProfileDir = $null

function Invoke-AsUser([string] $File, [string] $Arguments, [switch] $NoWait) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new($File, $Arguments)
  $psi.UserName = $UserName
  $psi.Domain = $env:COMPUTERNAME
  $psi.Password = $pw
  $psi.LoadUserProfile = $true
  $psi.UseShellExecute = $false
  $psi.WorkingDirectory = $stage
  if ($script:ProfileDir) {
    $p = $script:ProfileDir
    $psi.Environment['USERPROFILE'] = $p
    $psi.Environment['HOMEDRIVE'] = $p.Substring(0, 2)
    $psi.Environment['HOMEPATH'] = $p.Substring(2)
    $psi.Environment['USERNAME'] = $UserName
    $psi.Environment['APPDATA'] = Join-Path $p 'AppData\Roaming'
    $psi.Environment['LOCALAPPDATA'] = Join-Path $p 'AppData\Local'
    $psi.Environment['TEMP'] = Join-Path $p 'AppData\Local\Temp'
    $psi.Environment['TMP'] = Join-Path $p 'AppData\Local\Temp'
  }
  $proc = [System.Diagnostics.Process]::Start($psi)
  if (-not $NoWait) { $proc.WaitForExit() }
  return $proc
}

function Show-Diagnostics {
  Write-Host "---- diagnostics for '$UserName' ----"
  Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special } | ForEach-Object { Write-Host "profile: $($_.LocalPath)" }
  Get-ChildItem -LiteralPath 'C:\Users' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $progs = Join-Path $_.FullName 'AppData\Local\Programs'
    if (Test-Path -LiteralPath $progs) {
      Get-ChildItem -LiteralPath $progs -Force -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "programs entry: $($_.FullName)" }
    }
  }
}

try {
  # 1) First logon: creates the profile (and shows what env a naive launch gets).
  $envDump = Join-Path $stage "env-$([guid]::NewGuid().ToString('N')).txt"
  $p = Invoke-AsUser 'cmd.exe' "/d /c (set USERPROFILE & set LOCALAPPDATA & set TEMP & whoami) > `"$envDump`" 2>&1"
  Write-Host "environment seen by a plain launch as the user:"
  if (Test-Path -LiteralPath $envDump) { Get-Content -LiteralPath $envDump | ForEach-Object { Write-Host "  $_" } }

  $script:ProfileDir = (Get-CimInstance Win32_UserProfile | Where-Object { (Split-Path $_.LocalPath -Leaf) -eq $UserName } | Select-Object -First 1).LocalPath
  if (-not $script:ProfileDir) { throw "profile for $UserName was not created" }
  Write-Host "profile: $script:ProfileDir"
  $p = Invoke-AsUser 'cmd.exe' "/d /c if not exist `"%TEMP%`" mkdir `"%TEMP%`""

  # 2) Install exactly like a user double-clicking would (silently here).
  $p = Invoke-AsUser (Join-Path $stage 'setup.exe') '/S'
  Write-Host "installer exit code: $($p.ExitCode)"
  if ($p.ExitCode -ne 0) { throw "installer exited with $($p.ExitCode)" }
  $exe = Join-Path $script:ProfileDir 'AppData\Local\Programs\lol-viewer-next\lol-viewer-next.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "app not installed at $exe" }
  Write-Host "installed at $exe"

  # 3) Launch as the user and make sure it stays up.
  $app = Invoke-AsUser $exe '' -NoWait
  Start-Sleep -Seconds 10
  if ($app.HasExited) { throw "app exited right after launch (exit code $($app.ExitCode))" }
  Write-Host "app is running as $UserName (pid $($app.Id))"
  Get-Process lol-viewer-next -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2

  # 4) Uninstall.
  $un = (Get-ChildItem -LiteralPath (Split-Path $exe) -Filter 'Uninstall*.exe' | Select-Object -First 1).FullName
  $p = Invoke-AsUser $un '/S'
  if ($p.ExitCode -ne 0) { throw "uninstaller exited with $($p.ExitCode)" }
  for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath $exe); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path -LiteralPath $exe) { throw "app still present after uninstall" }
  Write-Host "OK: install / launch / uninstall as standard user '$UserName'"
}
catch {
  Show-Diagnostics
  throw
}
