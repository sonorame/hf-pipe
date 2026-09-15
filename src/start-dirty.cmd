@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo Leave this window open.
set HF_SIDE=dirty
:loop
"C:\Program Files\nodejs\node.exe" "%~dp0index.mjs" dirty
echo node exited %ERRORLEVEL% - restart in 4s
timeout /t 4 /nobreak >nul
goto loop
