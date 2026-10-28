@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js غير مثبت. نزّليه من https://nodejs.org ثم أعيدي التشغيل.
  pause
  exit /b
)
if not exist cloudflared.exe (
  echo ضعي ملف cloudflared.exe في هذا المجلد. حمّليه من:
  echo https://github.com/cloudflare/cloudflared/releases/latest
  echo ^(الملف cloudflared-windows-amd64.exe ثم غيّري اسمه إلى cloudflared.exe^)
  pause
  exit /b
)
set TRUST_PROXY=1
start "QMT Server" cmd /k node server.js
timeout /t 3 >nul
echo.
echo ابحثي في الأسطر التالية عن رابط ينتهي بـ trycloudflare.com وأرسليه للفريق.
echo الرابط يتغير كل مرة تشغلين فيها هذا الملف.
echo.
cloudflared.exe tunnel --url http://localhost:3000
pause
