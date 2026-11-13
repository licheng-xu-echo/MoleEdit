@echo off
rem Recreate the MolEdit Start Menu shortcut (use this after moving the folder
rem or if the shortcut was deleted).
rem Optional argument: -Desktop  (also create a desktop shortcut)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create-shortcut.ps1" %*
echo.
pause
