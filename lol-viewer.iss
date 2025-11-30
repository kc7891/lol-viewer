; Inno Setup Script for LoL Viewer
; This script creates a Windows installer for the application

#define MyAppName "LoL Viewer"
#define MyAppVersion "0.2.2"
#define MyAppPublisher "kc7891"
#define MyAppURL "https://github.com/kc7891/lol-viewer"
#define MyAppExeName "lol-viewer.exe"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
; Do not use the same AppId value in installers for other applications.
AppId={{8F7A2B3C-4D5E-6F7A-8B9C-0D1E2F3A4B5C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=installer_output
OutputBaseFilename=lol-viewer-setup
Compression=lzma
SolidCompression=yes
SetupIconFile=assets\icons\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; Silent install support
; CloseApplications=no to prevent Vanguard from crashing when updating
; The updater.py checks for running League/Vanguard processes before applying updates
CloseApplications=no
; Note: App restart is handled by [Run] section (postinstall without skipifsilent)
; RestartApplications is not used to prevent duplicate launches
; Automatically use the language from previous installation
UsePreviousLanguage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Include all files from the onedir build
Source: "dist\lol-viewer\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; NOTE: Don't use "Flags: ignoreversion" on any shared system files

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Launch after installation (both normal and silent mode)
; For silent updates, this ensures the app restarts after update
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall

; Note: [UninstallDelete] section removed to preserve user settings
; The settings.json file created by the application will remain after uninstall
; This allows settings to persist across reinstallations
