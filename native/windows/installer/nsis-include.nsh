; NSIS hooks for electron-builder (architecture §9, §13). electron-builder invokes these
; customInstall / customUnInstall macros. The native binaries are embedded by electron-builder
; under $INSTDIR\resources\bin (see electron-builder.yml extraResources).

!include LogicLib.nsh

; electron-builder's default process check treats every executable below $INSTDIR as the desktop
; app. That is unsafe for Talysman because talysman-svc.exe lives below $INSTDIR and SCM is
; configured to restart it after a forced termination. The default check can therefore get stuck
; in a kill/restart loop before customUnInstall ever has a chance to remove the service.
;
; Limit the generic app shutdown to the Electron executable. The native-messaging bridge is also
; safe to terminate (the browser recreates it when needed), while talysman-svcctl remains the sole
; owner of the privileged service lifecycle.
!macro customCheckAppRunning
  !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    ${IfNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${EndIf}

    DetailPrint "$(appClosing)"
    !insertmacro nsProcess::CloseProcess "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 1000
    !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      !insertmacro nsProcess::KillProcess "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 1000
      !insertmacro nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}" $R0
    ${EndIf}

    ${If} $R0 == 0
      MessageBox MB_OK|MB_ICONSTOP "$(appCannotBeClosed)" /SD IDOK
      Quit
    ${EndIf}
  ${EndIf}

  ; A browser can keep the native host alive after the tray app exits. It owns no persistent
  ; state, so end it explicitly to release the installed executable before upgrade/removal.
  !insertmacro nsProcess::KillProcess "talysman-natmsg.exe" $R0

  ; Compatibility bridge for upgrading releases that contain the old, path-wide process check.
  ; electron-builder invokes that old uninstaller after this macro. Stop its service gracefully
  ; first so the old check cannot enter the SCM kill/restart loop. Persistent enforcement remains
  ; in place during the short upgrade, and the new install hook restarts the replacement service.
  ${If} ${isUpdated}
  ${AndIf} ${FileExists} "$INSTDIR\resources\bin\talysman-svcctl.exe"
    DetailPrint "Stopping the existing Talysman service for upgrade..."
    nsExec::ExecToLog '"$INSTDIR\resources\bin\talysman-svcctl.exe" stop'
    Pop $R0

    StrCpy $R1 0
    ${Do}
      !insertmacro nsProcess::FindProcess "talysman-svc.exe" $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
      IntOp $R1 $R1 + 1
      ${If} $R1 >= 120
        MessageBox MB_OK|MB_ICONSTOP "The existing Talysman background service did not stop within 30 seconds.$\n$\nRestart Windows and run this installer again."
        Quit
      ${EndIf}
      Sleep 250
    ${Loop}
  ${EndIf}

  !insertmacro nsProcess::Unload
!macroend

!macro customInstall
  DetailPrint "Registering and starting the Talysman service..."
  ; svcctl install creates the LocalSystem auto-start service, configures SCM restart actions,
  ; and repairs native-messaging registration.
  nsExec::ExecToLog '"$INSTDIR\resources\bin\talysman-svcctl.exe" install'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Talysman could not install its background service (code $0).$\n$\nRestart Windows and run the installer again. If this continues, contact Talysman support." /SD IDOK
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  ; Guard: refuse to uninstall while focus is actively enforced and no paired key is present.
  nsExec::ExecToStack '"$INSTDIR\resources\bin\talysman-svcctl.exe" guard-uninstall'
  Pop $0
  ${If} $0 == 10
    MessageBox MB_OK|MB_ICONSTOP "Talysman is currently enforcing focus and no paired USB key is present.$\n$\nInsert your key, then uninstall again." /SD IDOK
    Abort
  ${ElseIf} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Talysman could not verify that uninstall is safe (code $0).$\n$\nRestart Windows and try again. If this continues, contact Talysman support." /SD IDOK
    Abort
  ${EndIf}

  DetailPrint "Removing the Talysman service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bin\talysman-svcctl.exe" uninstall'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "The Talysman background service could not be removed (code $0).$\n$\nNo application files were deleted. Restart Windows and run the uninstaller again." /SD IDOK
    Abort
  ${EndIf}

  ; Best-effort app_uninstalled (architecture §7-8/Phase 8). device-id.json lives in Electron's
  ; userData (%APPDATA%\Talysman for the invoking user); no API_BASE_URL is available here (it's
  ; baked into the Electron bundle at build time, not exported to the uninstaller), so the
  ; production URL is hardcoded — packaged public builds always point at production. Runs
  ; without checking its exit code: this must never block or fail the uninstall.
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "try { $$p = Join-Path $$env:APPDATA \"Talysman\\device-id.json\"; if (Test-Path $$p) { $$j = Get-Content $$p -Raw | ConvertFrom-Json; $$days = 0; if ($$j.installedAt) { $$days = [int]((Get-Date).ToUniversalTime() - [DateTime]::Parse($$j.installedAt).ToUniversalTime()).TotalDays }; $$body = @{ event=\"app_uninstalled\"; source=\"desktop\"; device_id=$$j.deviceId; occurred_at=(Get-Date).ToUniversalTime().ToString(\"o\"); platform=\"win32\"; props=@{ platform=\"win32\"; days_installed=$$days } } | ConvertTo-Json -Compress; Invoke-WebRequest -Uri \"https://www.talysman.app/api/analytics/track\" -Method Post -ContentType \"application/json\" -Body $$body -TimeoutSec 3 | Out-Null } } catch {}"'
!macroend
