# ══════════════════════════════════════════════════════════════
#  setup-task-scheduler.ps1
#  מגדיר את המשימה המתוזמנת של המצפן ב-Windows Task Scheduler
#  הרץ כ-Administrator פעם אחת: Right-click → Run as Administrator
# ══════════════════════════════════════════════════════════════

$TaskName   = "HaMatzpan-MorningScan"
$ScriptPath = "D:\פרויקט עוזר פיננסי\scripts\daily-scanner.js"
$LogPath    = "D:\פרויקט עוזר פיננסי\scripts\scanner.log"
$NodePath   = (Get-Command node -ErrorAction SilentlyContinue)?.Source

if (-not $NodePath) {
    Write-Error "❌ Node.js לא נמצא! התקן מ-https://nodejs.org ואז הרץ שוב."
    exit 1
}

Write-Host "✅ Node.js נמצא: $NodePath"
Write-Host "📋 מגדיר משימה: $TaskName"

# הסר משימה קיימת אם יש
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# הגדרת הפעולה — node daily-scanner.js עם לוג
$Action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "`"$ScriptPath`"" `
    -WorkingDirectory "D:\פרויקט עוזר פיננסי"

# טריגר — כל יום ב-08:00
$Trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

# הגדרות — רץ גם אם המחשב על סוללה, לא מפסיק על סוללה
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

# הרשאות — רץ כמשתמש הנוכחי
$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Highest

# רישום המשימה
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "HaMatzpan daily market scanner — MSTY/MSTR/IBIT/FX → Firestore" `
    -Force

Write-Host ""
Write-Host "══════════════════════════════════════════════"
Write-Host "  ✅ המשימה הוגדרה בהצלחה!"
Write-Host "  🕗 תרוץ כל יום ב-08:00"
Write-Host "  📁 לוג: $LogPath"
Write-Host ""
Write-Host "  כדי לבדוק: פתח Task Scheduler ← Task Scheduler Library"
Write-Host "  שם המשימה: $TaskName"
Write-Host "══════════════════════════════════════════════"
