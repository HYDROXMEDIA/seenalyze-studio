# SEENALYZE STUDIO Windows installer: one compact window instead of the standard wizard, in the
# same layout as Seenalyze Input's and Clipper's installers: near-black pages under a dot-grid
# hero (build/source/installer-hero.svg) with this app's purple accent on the primary pill.
# Welcome -> (optional Options) -> Installing -> Done. Everything is drawn
# on the stock window with nsDialogs; the stock buttons, header and branding are hidden. Silent
# installs and in-app updates never show these pages. Always installs for the current user, so
# no administrator prompt. Picture: build/installer/hero.bmp (scripts/render-installer-art.sh).
# Strings exist for every language in nsis.installerLanguages (src/main/installer-script.test.ts checks this).

# NSIS 3.12's Croatian catalog lacks the five standard install-mode strings.
# Supply them when that catalog is selected; keep compiler warnings fatal.
!include MUI2.nsh
!macroundef MUI_LANGUAGE
!macro MUI_LANGUAGE NLFID
  !if "${NLFID}" == "Croatian"
    !define MULTIUSER_TEXT_INSTALLMODE_TITLE "Odabir korisnika"
    !define MULTIUSER_TEXT_INSTALLMODE_SUBTITLE "Odaberite za koje korisnike želite instalirati $(^NameDA)."
    !define MULTIUSER_INNERTEXT_INSTALLMODE_TOP "Odaberite želite li instalirati $(^NameDA) samo za sebe ili za sve korisnike ovog računala. $(^ClickNext)"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS "Instaliraj za sve korisnike ovog računala"
    !define MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER "Instaliraj samo za mene"
  !endif
  !insertmacro MUI_LANGUAGEEX "${NSISDIR}\Contrib\Language files" "${NLFID}"
!macroend

# Palette (RRGGBB for SetCtlColors). The progress bar takes COLORREF values (0x00BBGGRR) in stInstShow.
!define ST_PAGE "0B0B0C"
!define ST_TEXT "FFFFFF"
!define ST_MUTED "9B9B9F"
!define ST_LINK "A0A0A4"
!define ST_ACCENT "C9A6FF"
!define ST_INK "1E0B3D"
!define ST_SECONDARY "232327"
!define ST_SECONDARY_TEXT "E0E0E2"
!define ST_FIELD "17171A"
!define ST_FIELD_TEXT "D9D9DB"
!define ST_CHECK_TEXT "D3D3D6"

!macro stLabel X Y W H TEXT FONT FG
  ${NSD_CreateLabel} ${X}px ${Y}px ${W}px ${H}px "${TEXT}"
  Pop $R1
  SetCtlColors $R1 "${FG}" "${ST_PAGE}"
  SendMessage $R1 ${WM_SETFONT} ${FONT} 1
  ${NSD_AddStyle} $R1 0x1
!macroend

# Clips a control to a rounded rectangle (RADIUS = half the height gives a pill). If Windows
# can't create the region, the control just keeps square corners: cosmetic only, so the
# result is intentionally not checked.
!macro stRound HWND W H RADIUS
  IntOp $R3 ${W} + 1
  IntOp $R4 ${H} + 1
  IntOp $R5 ${RADIUS} * 2
  System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i $R3, i $R4, i $R5, i $R5)p .R5'
  System::Call 'user32::SetWindowRgn(p ${HWND}, p $R5, i 1)'
!macroend

# A flat, clickable "button": a centered static control that notifies on click, with rounded
# corners when RADIUS is above 0.
!macro stButton X Y W H TEXT BG FG FONT HANDLER RADIUS
  ${NSD_CreateLabel} ${X}px ${Y}px ${W}px ${H}px "${TEXT}"
  Pop $R2
  SetCtlColors $R2 "${FG}" "${BG}"
  SendMessage $R2 ${WM_SETFONT} ${FONT} 1
  ${NSD_AddStyle} $R2 0x301
  ${NSD_OnClick} $R2 ${HANDLER}
  !if ${RADIUS} > 0
    !insertmacro stRound $R2 ${W} ${H} ${RADIUS}
  !endif
!macroend

!macro customInstallMode
  # Always for the current user: no administrator prompt, no mode page.
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  StrCpy $stFramed "0"
  StrCpy $stSkipOptions "1"
  StrCpy $stDesktop "1"
  StrCpy $stStart "1"
  StrCpy $stTitle "$(STUDIO_TITLE)"
  StrCpy $stTagline "$(STUDIO_TAGLINE)"
  StrCpy $stInstallText "$(STUDIO_INSTALL)"
  StrCpy $stOptionsText "$(STUDIO_OPTIONS)"
  StrCpy $stBackText "$(STUDIO_BACK)"
  StrCpy $stLocationText "$(STUDIO_LOCATION)"
  StrCpy $stBrowseText "$(STUDIO_BROWSE)"
  StrCpy $stDesktopText "$(STUDIO_DESKTOP)"
  StrCpy $stStartText "$(STUDIO_STARTMENU)"
  StrCpy $stInstallingText "$(STUDIO_INSTALLING)"
  StrCpy $stDoneText "$(STUDIO_DONE)"
  StrCpy $stOpenText "$(STUDIO_OPEN)"
  StrCpy $stDoneSubText "$(STUDIO_DONESUB)"
!macroend

# Honor the Options choices after the stock install created its shortcuts.
!macro customInstall
  ${If} $stDesktop != "1"
    Delete "$newDesktopLink"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
  ${If} $stStart != "1"
    Delete "$newStartMenuLink"
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !include nsDialogs.nsh
    !include LogicLib.nsh
    !include WinMessages.nsh

    Var stFramed
    Var stSkipOptions
    Var stDesktop
    Var stStart
    Var stDlg
    Var stDirField
    Var stDesktopBox
    Var stStartBox
    Var stFontTitle
    Var stFontBody
    Var stFontButton
    Var stTitle
    Var stTagline
    Var stInstallText
    Var stOptionsText
    Var stBackText
    Var stLocationText
    Var stBrowseText
    Var stDesktopText
    Var stStartText
    Var stInstallingText
    Var stDoneText
    Var stOpenText
    Var stDoneSubText

    LangString STUDIO_TITLE ${LANG_ENGLISH} "Install SEENALYZE STUDIO"
    LangString STUDIO_TITLE ${LANG_HUNGARIAN} "SEENALYZE STUDIO telepítése"
    LangString STUDIO_TITLE ${LANG_GERMAN} "SEENALYZE STUDIO installieren"
    LangString STUDIO_TITLE ${LANG_CZECH} "Nainstalovat SEENALYZE STUDIO"
    LangString STUDIO_TITLE ${LANG_SPANISHINTERNATIONAL} "Instalar SEENALYZE STUDIO"
    LangString STUDIO_TITLE ${LANG_PORTUGUESEBR} "Instalar o SEENALYZE STUDIO"
    LangString STUDIO_TITLE ${LANG_CROATIAN} "Instaliraj SEENALYZE STUDIO"
    LangString STUDIO_TAGLINE ${LANG_ENGLISH} "Stream, record and edit, all from one studio on your PC."
    LangString STUDIO_TAGLINE ${LANG_HUNGARIAN} "Közvetítés, felvétel és vágás, egyetlen stúdióban a számítógépeden."
    LangString STUDIO_TAGLINE ${LANG_GERMAN} "Streamen, aufnehmen und schneiden, alles in einem Studio auf deinem PC."
    LangString STUDIO_TAGLINE ${LANG_CZECH} "Streamujte, nahrávejte a stříhejte v jednom studiu ve svém počítači."
    LangString STUDIO_TAGLINE ${LANG_SPANISHINTERNATIONAL} "Transmite, graba y edita, todo desde un estudio en tu PC."
    LangString STUDIO_TAGLINE ${LANG_PORTUGUESEBR} "Transmita, grave e edite, tudo em um só estúdio no seu PC."
    LangString STUDIO_TAGLINE ${LANG_CROATIAN} "Emitiraj, snimaj i uređuj, sve iz jednog studija na svom računalu."
    LangString STUDIO_INSTALL ${LANG_ENGLISH} "Install"
    LangString STUDIO_INSTALL ${LANG_HUNGARIAN} "Telepítés"
    LangString STUDIO_INSTALL ${LANG_GERMAN} "Installieren"
    LangString STUDIO_INSTALL ${LANG_CZECH} "Instalovat"
    LangString STUDIO_INSTALL ${LANG_SPANISHINTERNATIONAL} "Instalar"
    LangString STUDIO_INSTALL ${LANG_PORTUGUESEBR} "Instalar"
    LangString STUDIO_INSTALL ${LANG_CROATIAN} "Instaliraj"
    LangString STUDIO_OPTIONS ${LANG_ENGLISH} "Options"
    LangString STUDIO_OPTIONS ${LANG_HUNGARIAN} "Beállítások"
    LangString STUDIO_OPTIONS ${LANG_GERMAN} "Optionen"
    LangString STUDIO_OPTIONS ${LANG_CZECH} "Možnosti"
    LangString STUDIO_OPTIONS ${LANG_SPANISHINTERNATIONAL} "Opciones"
    LangString STUDIO_OPTIONS ${LANG_PORTUGUESEBR} "Opções"
    LangString STUDIO_OPTIONS ${LANG_CROATIAN} "Mogućnosti"
    LangString STUDIO_BACK ${LANG_ENGLISH} "Back"
    LangString STUDIO_BACK ${LANG_HUNGARIAN} "Vissza"
    LangString STUDIO_BACK ${LANG_GERMAN} "Zurück"
    LangString STUDIO_BACK ${LANG_CZECH} "Zpět"
    LangString STUDIO_BACK ${LANG_SPANISHINTERNATIONAL} "Atrás"
    LangString STUDIO_BACK ${LANG_PORTUGUESEBR} "Voltar"
    LangString STUDIO_BACK ${LANG_CROATIAN} "Natrag"
    LangString STUDIO_LOCATION ${LANG_ENGLISH} "Install location"
    LangString STUDIO_LOCATION ${LANG_HUNGARIAN} "Telepítési hely"
    LangString STUDIO_LOCATION ${LANG_GERMAN} "Installationsort"
    LangString STUDIO_LOCATION ${LANG_CZECH} "Umístění instalace"
    LangString STUDIO_LOCATION ${LANG_SPANISHINTERNATIONAL} "Ubicación de instalación"
    LangString STUDIO_LOCATION ${LANG_PORTUGUESEBR} "Local de instalação"
    LangString STUDIO_LOCATION ${LANG_CROATIAN} "Mjesto instalacije"
    LangString STUDIO_BROWSE ${LANG_ENGLISH} "Browse…"
    LangString STUDIO_BROWSE ${LANG_HUNGARIAN} "Tallózás…"
    LangString STUDIO_BROWSE ${LANG_GERMAN} "Durchsuchen…"
    LangString STUDIO_BROWSE ${LANG_CZECH} "Procházet…"
    LangString STUDIO_BROWSE ${LANG_SPANISHINTERNATIONAL} "Examinar…"
    LangString STUDIO_BROWSE ${LANG_PORTUGUESEBR} "Procurar…"
    LangString STUDIO_BROWSE ${LANG_CROATIAN} "Pregledaj…"
    LangString STUDIO_DESKTOP ${LANG_ENGLISH} "Create a desktop shortcut"
    LangString STUDIO_DESKTOP ${LANG_HUNGARIAN} "Asztali parancsikon létrehozása"
    LangString STUDIO_DESKTOP ${LANG_GERMAN} "Desktop-Verknüpfung erstellen"
    LangString STUDIO_DESKTOP ${LANG_CZECH} "Vytvořit zástupce na ploše"
    LangString STUDIO_DESKTOP ${LANG_SPANISHINTERNATIONAL} "Crear un acceso directo en el escritorio"
    LangString STUDIO_DESKTOP ${LANG_PORTUGUESEBR} "Criar atalho na área de trabalho"
    LangString STUDIO_DESKTOP ${LANG_CROATIAN} "Stvori prečac na radnoj površini"
    LangString STUDIO_STARTMENU ${LANG_ENGLISH} "Add to Start menu"
    LangString STUDIO_STARTMENU ${LANG_HUNGARIAN} "Hozzáadás a Start menühöz"
    LangString STUDIO_STARTMENU ${LANG_GERMAN} "Zum Startmenü hinzufügen"
    LangString STUDIO_STARTMENU ${LANG_CZECH} "Přidat do nabídky Start"
    LangString STUDIO_STARTMENU ${LANG_SPANISHINTERNATIONAL} "Añadir al menú Inicio"
    LangString STUDIO_STARTMENU ${LANG_PORTUGUESEBR} "Adicionar ao menu Iniciar"
    LangString STUDIO_STARTMENU ${LANG_CROATIAN} "Dodaj u izbornik Start"
    LangString STUDIO_INSTALLING ${LANG_ENGLISH} "Installing…"
    LangString STUDIO_INSTALLING ${LANG_HUNGARIAN} "Telepítés…"
    LangString STUDIO_INSTALLING ${LANG_GERMAN} "Wird installiert…"
    LangString STUDIO_INSTALLING ${LANG_CZECH} "Instaluje se…"
    LangString STUDIO_INSTALLING ${LANG_SPANISHINTERNATIONAL} "Instalando…"
    LangString STUDIO_INSTALLING ${LANG_PORTUGUESEBR} "Instalando…"
    LangString STUDIO_INSTALLING ${LANG_CROATIAN} "Instalacija…"
    LangString STUDIO_DONE ${LANG_ENGLISH} "You're all set"
    LangString STUDIO_DONE ${LANG_HUNGARIAN} "Minden kész"
    LangString STUDIO_DONE ${LANG_GERMAN} "Alles bereit"
    LangString STUDIO_DONE ${LANG_CZECH} "Hotovo"
    LangString STUDIO_DONE ${LANG_SPANISHINTERNATIONAL} "Todo listo"
    LangString STUDIO_DONE ${LANG_PORTUGUESEBR} "Tudo pronto"
    LangString STUDIO_DONE ${LANG_CROATIAN} "Sve je spremno"
    LangString STUDIO_OPEN ${LANG_ENGLISH} "Open Studio"
    LangString STUDIO_OPEN ${LANG_HUNGARIAN} "Studio megnyitása"
    LangString STUDIO_OPEN ${LANG_GERMAN} "Studio öffnen"
    LangString STUDIO_OPEN ${LANG_CZECH} "Otevřít Studio"
    LangString STUDIO_OPEN ${LANG_SPANISHINTERNATIONAL} "Abrir Studio"
    LangString STUDIO_OPEN ${LANG_PORTUGUESEBR} "Abrir o Studio"
    LangString STUDIO_OPEN ${LANG_CROATIAN} "Otvori Studio"
    LangString STUDIO_DONESUB ${LANG_ENGLISH} "Studio is ready to use."
    LangString STUDIO_DONESUB ${LANG_HUNGARIAN} "A Studio használatra kész."
    LangString STUDIO_DONESUB ${LANG_GERMAN} "Studio ist einsatzbereit."
    LangString STUDIO_DONESUB ${LANG_CZECH} "Studio je připraveno k použití."
    LangString STUDIO_DONESUB ${LANG_SPANISHINTERNATIONAL} "Studio está listo para usarse."
    LangString STUDIO_DONESUB ${LANG_PORTUGUESEBR} "O Studio está pronto para uso."
    LangString STUDIO_DONESUB ${LANG_CROATIAN} "Studio je spreman za korištenje."

    # Sizes the stock window, hides its header, buttons and branding, and shows the
    # hero picture. Runs for every page because each page restores the stock controls.
    Function stFrame
      InitPluginsDir
      ${If} $stFramed != "1"
        StrCpy $stFramed "1"
        File /oname=$PLUGINSDIR\hero.bmp "${BUILD_RESOURCES_DIR}\installer\hero.bmp"
        CreateFont $stFontTitle "Segoe UI" 15 600
        CreateFont $stFontBody "Segoe UI" 9 400
        CreateFont $stFontButton "Segoe UI" 10 600
        System::Alloc 16
        Pop $R8
        System::Call '*$R8(i 0, i 0, i 500, i 380)'
        # WS_CAPTION | WS_SYSMENU, no menu: the outer size that keeps a 500 x 380 client area.
        System::Call 'user32::AdjustWindowRect(p $R8, i 0x00C80000, i 0)'
        System::Call '*$R8(i .R0, i .R1, i .R2, i .R3)'
        System::Free $R8
        IntOp $R2 $R2 - $R0
        IntOp $R3 $R3 - $R1
        System::Call 'user32::GetSystemMetrics(i 0)i .R4'
        System::Call 'user32::GetSystemMetrics(i 1)i .R5'
        IntOp $R4 $R4 - $R2
        IntOp $R4 $R4 / 2
        IntOp $R5 $R5 - $R3
        IntOp $R5 $R5 / 2
        System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $R4, i $R5, i $R2, i $R3, i 0x0004)'
        SetCtlColors $HWNDPARENT "" "${ST_PAGE}"
        # Dark title bar to match the dark window (DWMWA_USE_IMMERSIVE_DARK_MODE). Windows
        # versions without it keep their standard title bar: cosmetic only, so the result is
        # intentionally not checked.
        System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
        # The picture sits across the top of the window; pages use the area below it.
        System::Call 'user32::CreateWindowEx(i 0, t "STATIC", t "", i 0x5000000E, i 0, i 0, i 500, i 160, p $HWNDPARENT, p 0, p 0, p 0)p .R6'
        System::Call 'user32::LoadImage(p 0, t "$PLUGINSDIR\hero.bmp", i 0, i 0, i 0, i 0x10)p .R7'
        SendMessage $R6 0x172 0 $R7
      ${EndIf}
      # Stock Next/Back/Cancel, header and branding controls.
      ${ForEach} $R0 1 3 + 1
        GetDlgItem $R1 $HWNDPARENT $R0
        ShowWindow $R1 ${SW_HIDE}
      ${Next}
      ${ForEach} $R0 1028 1045 + 1
        GetDlgItem $R1 $HWNDPARENT $R0
        ${If} $R0 != 1018
          ShowWindow $R1 ${SW_HIDE}
        ${EndIf}
      ${Next}
      GetDlgItem $R1 $HWNDPARENT 1256
      ShowWindow $R1 ${SW_HIDE}
      GetDlgItem $R1 $HWNDPARENT 1018
      System::Call 'user32::SetWindowPos(p $R1, p 0, i 0, i 160, i 500, i 220, i 0x0014)'
    FunctionEnd

    Function stClickNext
      GetDlgItem $R0 $HWNDPARENT 1
      SendMessage $HWNDPARENT ${WM_COMMAND} 1 $R0
    FunctionEnd

    Function stWelcomeCreate
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      Call stFrame
      nsDialogs::Create 1018
      Pop $stDlg
      ${If} $stDlg == error
        Abort
      ${EndIf}
      SetCtlColors $stDlg "" "${ST_PAGE}"
      !insertmacro stLabel 30 8 440 32 $stTitle $stFontTitle ${ST_TEXT}
      !insertmacro stLabel 50 46 400 36 $stTagline $stFontBody ${ST_MUTED}
      !insertmacro stButton 165 92 170 38 $stInstallText ${ST_ACCENT} ${ST_INK} $stFontButton stWelcomeInstall 19
      !insertmacro stButton 165 142 170 22 $stOptionsText ${ST_PAGE} ${ST_LINK} $stFontBody stWelcomeOptions 0
      nsDialogs::Show
    FunctionEnd

    Function stWelcomeInstall
      StrCpy $stSkipOptions "1"
      Call stClickNext
    FunctionEnd

    Function stWelcomeOptions
      StrCpy $stSkipOptions "0"
      Call stClickNext
    FunctionEnd

    # Reads the Options fields back; the install folder always ends in the app folder
    # so uninstalling can never remove a folder the user already had.
    Function stOptionsSave
      ${NSD_GetText} $stDirField $INSTDIR
      ${NSD_GetState} $stDesktopBox $stDesktop
      ${NSD_GetState} $stStartBox $stStart
      StrLen $R2 "\${APP_FILENAME}"
      StrCpy $R3 $INSTDIR $R2 -$R2
      ${If} $R3 != "\${APP_FILENAME}"
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
    FunctionEnd

    Function stOptionsCreate
      ${If} $stSkipOptions == "1"
        Abort
      ${EndIf}
      Call stFrame
      nsDialogs::Create 1018
      Pop $stDlg
      ${If} $stDlg == error
        Abort
      ${EndIf}
      SetCtlColors $stDlg "" "${ST_PAGE}"
      !insertmacro stLabel 30 0 440 20 $stLocationText $stFontBody ${ST_MUTED}
      ${NSD_CreateText} 30px 24px 330px 26px "$INSTDIR"
      Pop $stDirField
      SetCtlColors $stDirField "${ST_FIELD_TEXT}" "${ST_FIELD}"
      SendMessage $stDirField ${WM_SETFONT} $stFontBody 1
      !insertmacro stButton 370 24 100 26 $stBrowseText ${ST_SECONDARY} ${ST_SECONDARY_TEXT} $stFontBody stOptionsBrowse 8
      # Themed checkboxes ignore SetCtlColors for their text, so draw them unthemed to keep the
      # light text readable on the dark page (as the progress bar does in stInstShow).
      ${NSD_CreateCheckbox} 30px 68px 440px 22px "$stDesktopText"
      Pop $stDesktopBox
      System::Call 'uxtheme::SetWindowTheme(p $stDesktopBox, w "", w "")'
      SetCtlColors $stDesktopBox "${ST_CHECK_TEXT}" "${ST_PAGE}"
      SendMessage $stDesktopBox ${WM_SETFONT} $stFontBody 1
      ${NSD_SetState} $stDesktopBox $stDesktop
      ${NSD_CreateCheckbox} 30px 96px 440px 22px "$stStartText"
      Pop $stStartBox
      System::Call 'uxtheme::SetWindowTheme(p $stStartBox, w "", w "")'
      SetCtlColors $stStartBox "${ST_CHECK_TEXT}" "${ST_PAGE}"
      SendMessage $stStartBox ${WM_SETFONT} $stFontBody 1
      ${NSD_SetState} $stStartBox $stStart
      !insertmacro stButton 30 160 100 34 $stBackText ${ST_SECONDARY} ${ST_SECONDARY_TEXT} $stFontButton stOptionsBack 17
      !insertmacro stButton 360 160 110 34 $stInstallText ${ST_ACCENT} ${ST_INK} $stFontButton stOptionsInstall 17
      nsDialogs::Show
    FunctionEnd

    Function stOptionsBrowse
      ${NSD_GetText} $stDirField $R0
      nsDialogs::SelectFolderDialog "$stLocationText" "$R0"
      Pop $R0
      ${If} $R0 != error
        ${NSD_SetText} $stDirField "$R0\${APP_FILENAME}"
      ${EndIf}
    FunctionEnd

    Function stOptionsBack
      Call stOptionsSave
      StrCpy $stSkipOptions "0"
      GetDlgItem $R0 $HWNDPARENT 3
      SendMessage $HWNDPARENT ${WM_COMMAND} 3 $R0
    FunctionEnd

    Function stOptionsInstall
      Call stClickNext
    FunctionEnd

    Function stOptionsLeave
      Call stOptionsSave
    FunctionEnd

    # The installing screen: the stock page with its list and buttons hidden, a title
    # and a slim rounded progress bar in the accent color on a dark track.
    Function stInstShow
      Call stFrame
      SetDetailsPrint none
      SetAutoClose true
      FindWindow $R0 "#32770" "" $HWNDPARENT
      SetCtlColors $R0 "" "${ST_PAGE}"
      GetDlgItem $R1 $R0 1016
      ShowWindow $R1 ${SW_HIDE}
      GetDlgItem $R1 $R0 1027
      ShowWindow $R1 ${SW_HIDE}
      GetDlgItem $R1 $R0 1006
      System::Call 'user32::SetWindowPos(p $R1, p 0, i 30, i 40, i 440, i 32, i 0x0014)'
      SendMessage $R1 ${WM_SETTEXT} 0 "STR:$stInstallingText"
      SendMessage $R1 ${WM_SETFONT} $stFontTitle 1
      SetCtlColors $R1 "${ST_TEXT}" "${ST_PAGE}"
      ${NSD_AddStyle} $R1 0x1
      GetDlgItem $R1 $R0 1004
      System::Call 'user32::SetWindowPos(p $R1, p 0, i 60, i 100, i 380, i 6, i 0x0014)'
      System::Call 'uxtheme::SetWindowTheme(p $R1, w "", w "")'
      # PBM_SETBARCOLOR / PBM_SETBKCOLOR take COLORREF (0x00BBGGRR): accent C9A6FF, track 232327.
      SendMessage $R1 0x409 0 0xFFA6C9
      SendMessage $R1 0x2001 0 0x272323
      !insertmacro stRound $R1 380 6 3
    FunctionEnd

    Function stDoneCreate
      Call stFrame
      nsDialogs::Create 1018
      Pop $stDlg
      ${If} $stDlg == error
        Abort
      ${EndIf}
      SetCtlColors $stDlg "" "${ST_PAGE}"
      !insertmacro stLabel 30 8 440 32 $stDoneText $stFontTitle ${ST_TEXT}
      !insertmacro stLabel 50 46 400 36 $stDoneSubText $stFontBody ${ST_MUTED}
      !insertmacro stButton 155 92 190 38 $stOpenText ${ST_ACCENT} ${ST_INK} $stFontButton stDoneOpen 19
      nsDialogs::Show
    FunctionEnd

    Function stDoneOpen
      ${StdUtils.ExecShellAsUser} $R0 "$launchLink" "open" ""
      Call stClickNext
    FunctionEnd
  !endif
!macroend

!macro customWelcomePage
  Page custom stWelcomeCreate
  Page custom stOptionsCreate stOptionsLeave
!macroend

# Defined before the stock installing page so its show callback applies to it.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW stInstShow
!macroend

!macro customFinishPage
  Page custom stDoneCreate
!macroend
