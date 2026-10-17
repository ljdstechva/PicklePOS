@echo off
rem ============================================================
rem  PicklePOS - TEST MODE
rem  Same app, but:
rem   - uses its own practice data (the "test-data" folder),
rem     separate from the real data used by Start POS.bat
rem   - shows the normal print dialog instead of printing silently
rem     (choose "Save as PDF" or Cancel if no receipt printer)
rem  To start the practice data over: close the window and delete
rem  the "test-data" folder.
rem ============================================================
set "HERE=%~dp0"
set "DATADIR=test-data"
set "KIOSK="
where powershell.exe >nul 2>nul || goto direct
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%HERE%launcher\PicklePOS.ps1" -DataDir test-data -NoKiosk
exit /b 0

:direct
rem PowerShell is missing: open the app directly (no automatic updates)
setlocal EnableDelayedExpansion
set "URL=file:///%HERE%index.html"
set "URL=!URL:\=/!"
set "URL=!URL: =%%20!"
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
  echo.
  echo  Google Chrome or Microsoft Edge was not found on this laptop.
  echo  Please install Google Chrome, then run this file again.
  echo.
  pause
  exit /b 1
)
if not exist "%HERE%%DATADIR%" mkdir "%HERE%%DATADIR%"
start "" "!BROWSER!" --user-data-dir="%HERE%%DATADIR%\browser-profile" --app="!URL!" %KIOSK% --start-maximized --no-first-run --no-default-browser-check --disable-features=Translate --disable-background-mode
endlocal
