; Migration bootstrapper: the final "LoL Viewer" (old PyQt app) update.
;
; The old app's updater downloads lol-viewer-setup.exe (via nightly.link) and runs it as
;   lol-viewer-setup.exe /NORESTART /DIR=<old install dir>
; Installed copies of the updater cannot change, so this script keeps that file name and
; command line, but installs "LoL Viewer Next" and then uninstalls the old app.
; Built by .github/workflows/release.yml and windows-build.yml, which first place the newest
; Next installer at next-installer\lol-viewer-next-setup.exe.

#define MyAppName "LoL Viewer"
#define MyAppPublisher "kc7891"
#define MyAppURL "https://github.com/kc7891/lol-viewer"
; AppId of the OLD app (lol-viewer.iss); "{{" in [Setup] is an escaped "{".
#define OldAppUninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\{8F7A2B3C-4D5E-6F7A-8B9C-0D1E2F3A4B5C}_is1"

[Setup]
; New AppId, distinct from the old app so the two never share uninstall data.
AppId={{4F275519-AEB5-4BEA-B2C6-96062F790F67}
AppName={#MyAppName}
AppVersion=1.0
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
; Nothing is installed by this script itself, so /DIR=... from the old updater is ignored.
Uninstallable=no
CreateAppDir=no
DisableWelcomePage=no
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
; Keep per-user: Next must be installed for the real user (no elevation override).
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=assets\icons\app_icon.ico
; Do not close running apps (Vanguard safety, same as the old installer).
CloseApplications=no
OutputDir=installer_output
OutputBaseFilename=lol-viewer-setup
Compression=lzma
SolidCompression=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[CustomMessages]
english.MigrateWelcome=LoL Viewer has been replaced by LoL Viewer Next.%n%nThis will install LoL Viewer Next and remove the old LoL Viewer. Settings are not carried over.
japanese.MigrateWelcome=LoL Viewer は LoL Viewer Next に置き換わりました。%n%nLoL Viewer Next をインストールし、旧版の LoL Viewer を削除します。設定は引き継がれません。
english.MigrateFailed=Installing LoL Viewer Next failed. The old LoL Viewer was not removed.%n%nPlease download LoL Viewer Next from https://github.com/kc7891/lol-viewer/releases
japanese.MigrateFailed=LoL Viewer Next のインストールに失敗しました。旧版の LoL Viewer は削除していません。%n%nhttps://github.com/kc7891/lol-viewer/releases から LoL Viewer Next をダウンロードしてください。

[Files]
Source: "next-installer\lol-viewer-next-setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion

[Code]
// Runs the old app's Inno uninstaller silently, if present. Failures are only logged.
procedure UninstallOldApp;
var
  Cmd: String;
  ResultCode: Integer;
  Found: Boolean;
  I: Integer;
begin
  // Per-user install (HKCU), then per-machine 64-bit view, then 32-bit view.
  for I := 0 to 2 do
  begin
    Cmd := '';
    if I = 0 then
      Found := RegQueryStringValue(HKCU, '{#OldAppUninstallKey}', 'UninstallString', Cmd)
    else if I = 1 then
      Found := RegQueryStringValue(HKLM64, '{#OldAppUninstallKey}', 'UninstallString', Cmd)
    else
      Found := RegQueryStringValue(HKLM32, '{#OldAppUninstallKey}', 'UninstallString', Cmd);
    if Found then
    begin
      Cmd := RemoveQuotes(Cmd);
      if FileExists(Cmd) then
      begin
        if Exec(Cmd, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
          Log(Format('Old app uninstaller %s finished with code %d', [Cmd, ResultCode]))
        else
          Log(Format('Failed to run old app uninstaller %s: %s', [Cmd, SysErrorMessage(ResultCode)]));
      end
      else
        Log('Old app uninstaller not found: ' + Cmd);
    end;
  end;
end;

procedure InitializeWizard;
begin
  // Explain the migration on the welcome page.
  WizardForm.WelcomeLabel2.Caption := CustomMessage('MigrateWelcome');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Params: String;
  Ok: Boolean;
begin
  if CurStep = ssPostInstall then
  begin
    // 1. Install LoL Viewer Next (interactive wizard unless this setup is silent).
    if WizardSilent then
      Params := '/S'
    else
      Params := '';
    Ok := Exec(ExpandConstant('{tmp}\lol-viewer-next-setup.exe'), Params, '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
    if (not Ok) or (ResultCode <> 0) then
    begin
      if Ok then
        Log(Format('LoL Viewer Next installer exited with code %d', [ResultCode]))
      else
        Log('Failed to run LoL Viewer Next installer: ' + SysErrorMessage(ResultCode));
      // Keep the old app: do not uninstall it.
      SuppressibleMsgBox(CustomMessage('MigrateFailed'), mbError, MB_OK, IDOK);
      Exit;
    end;
    // 2. Next is installed: remove the old app.
    UninstallOldApp;
  end;
end;
