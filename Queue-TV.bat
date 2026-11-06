@echo off
chcp 65001 >nul
REM ================================================================
REM  Prof Ali Kotb - Smart Queue : waiting-room TV with sound ON
REM
REM  Fill in ONLY the two lines below:
REM   CLINIC = toukh   or   heliopolis
REM   KEY    = the value after  k=  in the TV link
REM            (Admin -> الروابط -> "شاشة الانتظار (التلفزيون)" -> نسخ,
REM             then copy only the letters between  k=  and  &label )
REM
REM  Double-click this file. Close the TV screen with Alt+F4.
REM ================================================================
set "CLINIC=toukh"
set "KAb3dEf9GhJ2kLm7NpQ"

set "SITE=https://call-patients-order.vercel.app"

REM ---- checks -----------------------------------------------------
if "%KEY%"=="PASTE_KEY_HERE" ( echo [!] Edit this file first: put your display KEY on the "set KEY=" line. & pause & exit /b 1 )
echo "%KEY%" | findstr /c:"…" /c:"..." /c:" " /c:"&" /c:"=" >nul && ( echo [!] KEY looks wrong - paste only the letters after k= ^(no dots, spaces, ^& or =^). & pause & exit /b 1 )

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" ( echo [!] Microsoft Edge not found. & pause & exit /b 1 )

REM label kept plain English: % or Arabic inside a .bat line would be corrupted
set "URL=%SITE%/display/%CLINIC%?k=%KEY%&label=TV-%CLINIC%&auto=1"

REM separate profile = the sound flags always apply, even if Edge is already open
start "" "%EDGE%" --user-data-dir="%LOCALAPPDATA%\QueueTV" --kiosk "%URL%" --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required --no-first-run --disable-features=Translate
