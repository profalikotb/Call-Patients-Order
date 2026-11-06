@echo off
chcp 65001 >nul
REM ================================================================
REM  Prof Ali Kotb - Smart Queue : waiting-room TV with sound ON
REM  1) Paste the display link from  الإدارة -> الروابط  between the quotes below
REM     (keep "&auto=1" at the end - it switches sound on without a click)
REM  2) Double-click this file. Close with Alt+F4.
REM ================================================================
   set "URL=https://call-patients-order.vercel.app/display/toukh?k=…&label=…&auto=1"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" ( echo Microsoft Edge not found. & pause & exit /b 1 )

echo "%URL%" | find "PASTE_DISPLAY_LINK_HERE" >nul && ( echo Edit this file first: paste the display link into URL. & pause & exit /b 1 )

REM separate profile = flags always apply, even if Edge is already open
start "" "%EDGE%" --user-data-dir="%LOCALAPPDATA%\QueueTV" --kiosk "%URL%" --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required --no-first-run --disable-features=Translate
