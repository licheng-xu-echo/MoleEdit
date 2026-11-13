@echo off
rem Start the MolEdit local HTTP server and open it in the browser.
rem Use this if your browser blocks local file:// scripts.
cd /d "%~dp0"
start "" cmd /c "timeout /t 1 /nobreak >nul && start "" http://127.0.0.1:8777/"
node server.mjs 8777
