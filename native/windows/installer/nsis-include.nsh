; NSIS hooks for electron-builder (architecture §9, §13). electron-builder invokes these
; customInstall / customUnInstall macros. The native binaries are embedded by electron-builder
; under $INSTDIR\resources\bin (see electron-builder.yml extraResources).

!include LogicLib.nsh

!macro customInstall
  DetailPrint "Registering and starting the Talysman service..."
  ; svcctl install: creates the LocalSystem auto-start service, configures SCM restart
  ; recovery, and generates the one-time recovery code (written to
  ; %PROGRAMDATA%\Talysman\recovery-code.txt and printed to the install log).
  nsExec::ExecToLog '"$INSTDIR\resources\bin\talysman-svcctl.exe" install'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Talysman service install returned code $0. You can retry later with:$\n  talysman-svcctl.exe install$\n(run as administrator)."
  ${EndIf}
  MessageBox MB_OK|MB_ICONINFORMATION "Your Talysman recovery code was saved to:$\n  %PROGRAMDATA%\Talysman\recovery-code.txt$\n$\nSave it somewhere safe. It can unlock focus if you ever lose your USB key."
!macroend

!macro customUnInstall
  ; Guard: refuse to uninstall while focus is actively enforced and no paired key is present.
  nsExec::ExecToStack '"$INSTDIR\resources\bin\talysman-svcctl.exe" guard-uninstall'
  Pop $0
  ${If} $0 == 10
    MessageBox MB_OK|MB_ICONSTOP "Talysman is currently enforcing focus and no paired USB key is present.$\n$\nInsert your key (or run talysman-recover.exe with your recovery code), then uninstall again."
    Abort
  ${EndIf}

  DetailPrint "Removing the Talysman service..."
  nsExec::ExecToLog '"$INSTDIR\resources\bin\talysman-svcctl.exe" uninstall'
  Pop $0
!macroend
