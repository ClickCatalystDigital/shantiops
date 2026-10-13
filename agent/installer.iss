; Inno Setup script for the Shanti device/browser approval agent.
; Built by CI (.github/workflows/agent-windows.yml) against dist\shanti-agent.exe (PyInstaller
; onefile build) — not meant to be compiled by hand without running that build first.
;
; Two enrollment paths:
;   1. Zero-typing: a shanti-enroll.json placed next to this installer is copied to ProgramData;
;      the agent redeems it on first run. No prompts.
;   2. Manual: the wizard asks for an enrollment code (server URL pre-filled).
#define MyAppName "Shanti Agent"
#define MyAppVersion "1.2.1"
#define MyAppExeName "shanti-agent.exe"
#define DefaultServerUrl "http://localhost:3000"
; Set once the browser extension is published to the Chrome Web Store; empty = don't force-install.
#define ExtensionId "olhkhmeombmmgobcdmhojnngolecijcc"

[Setup]
AppId={{7C2E9B1A-4F3D-4A6E-9C2B-1D8E6F0A5B3C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Shanti Boilers
DefaultDirName={autopf}\ShantiAgent
DefaultGroupName=Shanti Agent
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=ShantiAgentSetup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "dist\shanti-agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Code]
var
  ConfigPage: TInputQueryWizardPage;
  HasSidecar: Boolean;

function SidecarPath: string;
begin
  Result := ExpandConstant('{src}\shanti-enroll.json');
end;

procedure InitializeWizard;
begin
  HasSidecar := FileExists(SidecarPath);
  if HasSidecar then exit;   // zero-typing path — no questions asked

  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Agent Setup', 'Connect this machine to your SB Ops server',
    'Enter the enrollment code from your manager. (Advanced: change the server URL only if told to.)');
  ConfigPage.Add('Enrollment code:', False);
  ConfigPage.Add('Server URL:', False);
  ConfigPage.Values[0] := ExpandConstant('{param:EnrollCode|}');
  ConfigPage.Values[1] := ExpandConstant('{param:ServerUrl|{#DefaultServerUrl}}');
end;

function GetCode: string;
begin
  Result := ConfigPage.Values[0];
end;

function GetServerUrl: string;
begin
  Result := ConfigPage.Values[1];
end;

function HasBadChars(s: string): Boolean;
begin
  Result := (Pos('"', s) > 0) or (Pos('\', s) > 0);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (not HasSidecar) and (CurPageID = ConfigPage.ID) then begin
    if HasBadChars(GetCode) or HasBadChars(GetServerUrl) then begin
      MsgBox('Code and server URL must not contain " or \', mbError, MB_OK);
      Result := False;
    end else if GetCode = '' then begin
      MsgBox('Please enter the enrollment code.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigDir, ConfigPath, JsonContent: string;
  Existing: AnsiString;
begin
  if CurStep <> ssPostInstall then exit;
  ConfigDir := ExpandConstant('{commonappdata}\ShantiAgent');
  ForceDirectories(ConfigDir);
  ConfigPath := ConfigDir + '\config.json';

  if HasSidecar then begin
    // Fresh install / re-enroll: copy the enrollment file; the agent reads it on first run.
    FileCopy(SidecarPath, ConfigDir + '\shanti-enroll.json', False);
    JsonContent := '{' + #13#10 + '  "token": "",' + #13#10 + '  "poll_seconds": 5' + #13#10 + '}';
    SaveStringToFile(ConfigPath, JsonContent, False);
    exit;
  end;

  // Update-safety: if a config with a real token already exists (an auto-update re-running the
  // installer), never overwrite it — that would blank the machine's credential.
  if LoadStringFromFile(ConfigPath, Existing) and (Pos('"token": ""', Existing) = 0)
     and (Pos('"token":""', Existing) = 0) and (Pos('"token"', Existing) > 0) then
    exit;

  JsonContent :=
    '{' + #13#10 +
    '  "server_url": "' + GetServerUrl + '",' + #13#10 +
    '  "enroll_code": "' + GetCode + '",' + #13#10 +
    '  "token": "",' + #13#10 +
    '  "poll_seconds": 5' + #13#10 +
    '}';
  SaveStringToFile(ConfigPath, JsonContent, False);
end;

[Registry]
; Force-install the browser extension on Chrome and Edge (Edge honors the Chrome Web Store update
; URL). Only written once an extension ID is set — until then these entries are skipped.
Root: HKLM; Subkey: "SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"; \
  ValueType: string; ValueName: "1"; \
  ValueData: "{#ExtensionId};https://clients2.google.com/service/update2/crx"; \
  Flags: uninsdeletevalue; Check: ForceExtension
Root: HKLM; Subkey: "SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"; \
  ValueType: string; ValueName: "1"; \
  ValueData: "{#ExtensionId};https://clients2.google.com/service/update2/crx"; \
  Flags: uninsdeletevalue; Check: ForceExtension

[Code]
function ForceExtension: Boolean;
begin
  Result := '{#ExtensionId}' <> '';
end;

[Run]
Filename: "{sys}\schtasks.exe"; Parameters: "/create /tn ShantiUsbAgent /tr ""{app}\{#MyAppExeName}"" /sc onstart /ru SYSTEM /rl HIGHEST /f"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/run /tn ShantiUsbAgent"; Flags: runhidden

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/end /tn ShantiUsbAgent"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/delete /tn ShantiUsbAgent /f"; Flags: runhidden
