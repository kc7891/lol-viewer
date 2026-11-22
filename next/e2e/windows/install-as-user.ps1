<#
  Installs, launches and uninstalls the app as a freshly created STANDARD
  (non-admin) local user, the way most players run it.
  Usage: pwsh -File install-as-user.ps1 -Setup <setup.exe> -UserName <name>
  On failure, prints where the installer actually put files.
#>
param(
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $UserName
)
$ErrorActionPreference = 'Stop'

function Show-Diagnostics {
  Write-Host "---- diagnostics for '$UserName' ----"
  Write-Host "profiles:"
  Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special } | ForEach-Object { Write-Host "  $($_.LocalPath)" }
  Write-Host "lol-viewer-next.exe anywhere under C:\Users:"
  Get-ChildItem -LiteralPath 'C:\Users' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $progs = Join-Path $_.FullName 'AppData\Local\Programs'
    if (Test-Path -LiteralPath $progs) {
      Get-ChildItem -LiteralPath $progs -Recurse -Depth 2 -Filter 'lol-viewer-next.exe' -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  $($_.FullName)" }
    }
  }
  Write-Host "installer temp leftovers:"
  Get-ChildItem -LiteralPath 'C:\Users' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $t = Join-Path $_.FullName 'AppData\Local\Temp'
    if (Test-Path -LiteralPath $t) { Get-ChildItem -LiteralPath $t -Filter 'ns*.tmp' -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" } }
  }
}

$plain = 'Lv!' + [guid]::NewGuid().ToString('N').Substring(0, 16)
$pw = ConvertTo-SecureString $plain -AsPlainText -Force
New-LocalUser -Name $UserName -Password $pw -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -Group 'Users' -Member $UserName
if ((Get-LocalGroupMember -Group 'Administrators').Name -match [regex]::Escape($UserName)) { throw "test user must not be an admin" }
$cred = New-Object System.Management.Automation.PSCredential(".\$UserName", $pw)

# Other users cannot read the runner's checkout; stage the setup in a shared folder.
$stage = 'C:\Users\Public\lv-setup'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -LiteralPath $Setup (Join-Path $stage 'setup.exe') -Force

try {
  $p = Start-Process (Join-Path $stage 'setup.exe') -ArgumentList '/S' -Credential $cred -LoadUserProfile -WorkingDirectory $stage -Wait -PassThru
  Write-Host "installer exit code: $($p.ExitCode)"
  if ($p.ExitCode -ne 0) { throw "installer exited with $($p.ExitCode)" }

  $profileDir = (Get-CimInstance Win32_UserProfile | Where-Object { (Split-Path $_.LocalPath -Leaf) -eq $UserName } | Select-Object -First 1).LocalPath
  if (-not $profileDir) { throw "profile for $UserName not found" }
  $exe = Join-Path $profileDir 'AppData\Local\Programs\lol-viewer-next\lol-viewer-next.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw "app not installed at $exe" }
  Write-Host "installed at $exe"

  $app = Start-Process -FilePath $exe -Credential $cred -LoadUserProfile -WorkingDirectory (Split-Path $exe) -PassThru
  Start-Sleep -Seconds 10
  if (-not (Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) { throw "app exited right after launch (exit code $($app.ExitCode))" }
  Write-Host "app is running as $UserName"
  Get-Process lol-viewer-next -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2

  $un = (Get-ChildItem -LiteralPath (Split-Path $exe) -Filter 'Uninstall*.exe' | Select-Object -First 1).FullName
  $p = Start-Process -FilePath $un -ArgumentList '/S' -Credential $cred -LoadUserProfile -WorkingDirectory $stage -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "uninstaller exited with $($p.ExitCode)" }
  for ($i = 0; $i -lt 20 -and (Test-Path -LiteralPath $exe); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path -LiteralPath $exe) { throw "app still present after uninstall" }
  Write-Host "OK: install / launch / uninstall as standard user '$UserName'"
}
catch {
  Show-Diagnostics
  throw
}
