@echo off
chcp 65001 > nul
echo.
echo ╔══════════════════════════════════════════════╗
echo ║   HaMatzpan · Daily Scanner  V2.4.0         ║
echo ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [שגיאה] Node.js לא מותקן. הורד מ- https://nodejs.org
    pause
    exit /b 1
)

echo מריץ סריקה...
node scripts\daily-scanner.js

if %errorlevel% equ 0 (
    echo.
    echo ✅ הסריקה הושלמה בהצלחה. public\daily_scan.json עודכן.
) else (
    echo.
    echo ❌ הסריקה נכשלה. בדוק חיבור לאינטרנט.
)

echo.
pause
