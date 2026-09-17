@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" if exist "%~dp0..\node.exe" set "NODE=%~dp0..\node.exe"
if not exist "%NODE%" set "NODE=node.exe"
echo.
echo === hop-up ===
echo NODE=%NODE%
"%NODE%" "%~dp0hop-up.mjs"
set "EC=%ERRORLEVEL%"
echo.
if "%EC%"=="0" echo === GREEN: kanal zhiv. Eto okno mozhno zakryt. Okno hf-dirty ostav. ===
if not "%EC%"=="0" echo === RED: chitay stroku NEXT vyshe. ===
echo.
pause
exit /b %EC%
