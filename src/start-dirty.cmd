@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo Leave this window open.
set HF_SIDE=dirty
:loop
"C:\Program Files\nodejs\node.exe" "%~dp0index.mjs" dirty
echo node exited %ERRORLEVEL% - restart in 4s
ping 127.0.0.1 -n 5 >nul
goto loop
