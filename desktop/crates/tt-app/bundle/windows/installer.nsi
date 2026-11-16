; NSIS-installer for TimeTrack 0.2.23 og frem (tt-app, den nye app).
;
; Installeres oven i Tauri-appen (til og med 0.2.22) og afløser den: samme
; produktnavn, mappe ($LOCALAPPDATA\TimeTrack, pr. bruger, ingen admin) og
; registreringsnøgler som Tauri's NSIS-skabelon, så "Apps og funktioner"
; viser én TimeTrack. Den nye exe hedder timetrack.exe; den gamle
; (timetrack-desktop.exe) stoppes og slettes, og genveje, timetrack:// og
; autostart (HKCU\...\Run, værdien TimeTrack) flyttes til den nye med
; --autostart, så de to aldrig kører samtidig.
;
; Argumenter (de samme som Tauri-updaterens NSIS-tilstande, så både 0.2.22
; og den nye app kan starte installeren):
;   /S       stille (NSIS)
;   /P       passiv: ingen spørgsmål (behandles som /S)
;   /R       start TimeTrack efter installationen
;   /UPDATE  opdatering: rør ikke skrivebordsgenvejen
;
; Bygges af scripts/bundle-windows.ps1:
;   makensis /DVERSION=0.2.23 /DSRC=<mappe med timetrack.exe> /DOUTFILE=<sti> installer.nsi

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!ifndef VERSION
  !error "VERSION mangler (/DVERSION=0.2.23)"
!endif
!ifndef SRC
  !error "SRC mangler (/DSRC=mappe med timetrack.exe)"
!endif
!ifndef OUTFILE
  !define OUTFILE "TimeTrack_${VERSION}_x64-setup.exe"
!endif

!define PRODUCTNAME "TimeTrack"
!define MANUFACTURER "timetrack"
!define BUNDLEID "dk.timetrack.desktop"
!define MAINBINARYNAME "timetrack"
; Den gamle Tauri-apps exe, som den nye afløser.
!define OLDBINARYNAME "timetrack-desktop"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUPRODUCTKEY "Software\${MANUFACTURER}\${PRODUCTNAME}"
!define URLKEY "Software\Classes\timetrack"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${PRODUCTNAME}"
InstallDirRegKey HKCU "${MANUPRODUCTKEY}" ""
BrandingText "${PRODUCTNAME} ${VERSION}"

!ifndef VIVERSION
  !define VIVERSION "${VERSION}.0"
!endif
VIProductVersion "${VIVERSION}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Mahope"
VIAddVersionKey "LegalCopyright" "Mahope"

!define MUI_ICON "TimeTrack.ico"
!define MUI_UNICON "TimeTrack.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${MAINBINARYNAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start TimeTrack"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Danish"
!insertmacro MUI_LANGUAGE "English"

Var Relaunch
Var IsUpdate
Var MsiCode
Var MsiVersion

; Spørgsmålet, når 0.2.x er installeret med MSI for alle brugere (se OfferOldMsiRemoval).
LangString MSG_OLD_MSI ${LANG_DANISH} "En gammel version af TimeTrack (MSI, version $MsiVersion) er installeret for alle brugere og ligger stadig på computeren.$\r$\n$\r$\nVil du afinstallere den nu? Windows beder om administratorrettigheder.$\r$\n$\r$\nVælger du Nej, kan du fjerne den senere under Indstillinger → Apps → TimeTrack (gammel version) → Afinstallér."
LangString MSG_OLD_MSI ${LANG_ENGLISH} "An old version of TimeTrack (MSI, version $MsiVersion) is installed for all users and is still on this computer.$\r$\n$\r$\nDo you want to uninstall it now? Windows will ask for administrator rights.$\r$\n$\r$\nIf you choose No, you can remove it later under Settings → Apps → TimeTrack (old version) → Uninstall."

Function .onInit
  StrCpy $Relaunch 0
  StrCpy $IsUpdate 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/P" $1
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "/R" $1
  ${IfNot} ${Errors}
    StrCpy $Relaunch 1
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $IsUpdate 1
  ${EndIf}
FunctionEnd

; Luk en kørende TimeTrack (den gamle eller den nye), så exe'en kan
; overskrives. Den gamle lukker til tray ved WM_CLOSE, så /F bagefter.
; Ingen /T på den nye exe: installeren kan være dens barn (updateren).
!macro CloseApp
  nsExec::Exec 'taskkill /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  nsExec::Exec 'taskkill /IM "${OLDBINARYNAME}.exe"'
  Pop $0
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "${OLDBINARYNAME}.exe"'
  Pop $0
  Sleep 500
!macroend

; Find en MSI-installation af 0.2.x i HKLM\...\Uninstall: DisplayName
; "TimeTrack" og WindowsInstaller=1 (NSIS-installationen har ikke den
; værdi). $0 er registervisningen (64 eller 32). Sætter $MsiCode (produktkoden)
; og $MsiVersion, hvis den findes. Bruger $1-$4.
!macro FindOldMsi VIEW
  ${If} $MsiCode == ""
    SetRegView ${VIEW}
    StrCpy $1 0
    ${Do}
      EnumRegKey $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $1
      ${If} $2 == ""
        ${Break}
      ${EndIf}
      IntOp $1 $1 + 1
      ReadRegStr $3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$2" "DisplayName"
      ${If} $3 == "${PRODUCTNAME}"
        ReadRegDWORD $4 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$2" "WindowsInstaller"
        ; Kun en rigtig produktkode ({GUID}, 38 tegn) ender i msiexec's kommandolinje.
        StrLen $3 $2
        StrCpy $5 $2 1
        ${If} $4 == 1
        ${AndIf} $3 == 38
        ${AndIf} $5 == "{"
          StrCpy $MsiCode $2
          ReadRegStr $MsiVersion HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$2" "DisplayVersion"
          ${Break}
        ${EndIf}
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend

; 0.2.x kan være installeret med MSI for alle brugere (Program Files). Det kan
; kun fjernes med administratorrettigheder, så installeren fjerner det ikke
; selv, men spørger (kun når den kører med vindue) og starter afinstallationen
; med UAC (verbet "runas"). Siger brugeren nej, eller kører den stille (også
; opdateringen), viser appen en besked ved første start (afloesning.rs).
Function OfferOldMsiRemoval
  StrCpy $MsiCode ""
  StrCpy $MsiVersion ""
  !insertmacro FindOldMsi 64
  !insertmacro FindOldMsi 32
  SetRegView 32
  ${If} $MsiCode != ""
  ${AndIfNot} ${Silent}
    ${If} $MsiVersion == ""
      StrCpy $MsiVersion "?"
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONQUESTION "$(MSG_OLD_MSI)" IDNO msi_done
    ExecShell "runas" "msiexec.exe" "/x $MsiCode /passive" SW_SHOWNORMAL
    msi_done:
  ${EndIf}
FunctionEnd

Section "TimeTrack" SecMain
  SectionIn RO
  !insertmacro CloseApp
  SetOutPath "$INSTDIR"
  ; Filer fra Tauri-appen, som den nye app ikke bruger, også den gamle exe.
  ; Er den stadig låst, slettes den ved næste genstart. Brugerdata ligger i
  ; %APPDATA% og røres ikke.
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete /REBOOTOK "$INSTDIR\${OLDBINARYNAME}.exe"
  File "${SRC}\${MAINBINARYNAME}.exe"
  File "/oname=TimeTrack.ico" "TimeTrack.ico"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Samme nøgler som Tauri's NSIS-skabelon (pr. bruger).
  WriteRegStr HKCU "${MANUPRODUCTKEY}" "" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\TimeTrack.ico$\""
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Mahope"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"

  ; timetrack:// til browser-login (appen gør det også selv ved start).
  WriteRegStr HKCU "${URLKEY}" "" "URL:TimeTrack"
  WriteRegStr HKCU "${URLKEY}" "URL Protocol" ""
  WriteRegStr HKCU "${URLKEY}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "${URLKEY}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; Autostart: var den slået til (den gamle app eller en tidligere
  ; installation), peger den nu på den nye exe og starter skjult i tray.
  ; Den slås aldrig til her.
  ClearErrors
  ReadRegStr $0 HKCU "${RUNKEY}" "${PRODUCTNAME}"
  ${IfNot} ${Errors}
    WriteRegStr HKCU "${RUNKEY}" "${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --autostart"
  ${EndIf}

  ; Genveje. Startmenuen altid; skrivebordet ved ny installation, og ved
  ; opdatering kun hvis den fandtes (brugeren kan have slettet den).
  ; Samme filnavne som den gamle app, så dens genveje erstattes.
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\TimeTrack.ico" 0
  ${If} $IsUpdate == 0
  ${OrIf} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\TimeTrack.ico" 0
  ${EndIf}

  Call OfferOldMsiRemoval
SectionEnd

Function .onInstSuccess
  ${If} $Relaunch == 1
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  !insertmacro CloseApp
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  Delete "$INSTDIR\${OLDBINARYNAME}.exe"
  Delete "$INSTDIR\TimeTrack.ico"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "${MANUPRODUCTKEY}"
  DeleteRegKey /ifempty HKCU "Software\${MANUFACTURER}"
  DeleteRegKey HKCU "${URLKEY}"
  ; Autostart fra den gamle eller den nye app (værdien hedder TimeTrack).
  DeleteRegValue HKCU "${RUNKEY}" "${PRODUCTNAME}"
  ; Data i %APPDATA%\TimeTrack og %APPDATA%\dk.timetrack.desktop bevares.
SectionEnd
