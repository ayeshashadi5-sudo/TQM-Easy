@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js غير مثبت. نزّليه من https://nodejs.org ^(النسخة LTS^) ثم شغّلي هذا الملف مرة أخرى.
  pause
  exit /b
)
node server.js
pause
