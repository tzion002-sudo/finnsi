# setup-task-scheduler.ps1
# Configures HaMatzpan daily scanner in Windows Task Scheduler
# Run once as Administrator

$TaskName   = "HaMatzpan-MorningScan"
$ScriptPath = "D:\פרויקט עוזר פיננסי\scripts\daily-scanner.js"
$NodeCmd    = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Error "Node.js not found! Install from https://nodejs.org and try again."
    exit 1
}
$NodePath = $NodeCmd.Source

Write-Host "Node.js found: $NodePath"
Write-Host "Registering task: $TaskName"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Action: run node daily-scanner.js
$Action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "`"$ScriptPath`"" `
    -WorkingDirectory "D:\פרויקט עוזר פיננסי"

# Trigger: every day at 08:00
$Trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

# Settings
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

# Principal: current user
$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Highest

# Register
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "HaMatzpan daily market scanner - MSTY/MSTR/IBIT/FX -> Firestore" `
    -Force

Write-Host ""
Write-Host "=============================================="
Write-Host "  Task registered successfully!"
Write-Host "  Runs every day at 08:00"
Write-Host "  Task name: $TaskName"
Write-Host "  To verify: open Task Scheduler -> Task Scheduler Library"
Write-Host "=============================================="
