# DailyAI Pulse Scheduler Script
# This script registers a daily Task Scheduler task in Windows to run at 9:00 AM.

$ScriptName = "DailyAI-Pulse"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatchPath = Join-Path $ScriptDir "run-daily.bat"

Write-Host "Setting up DailyAI-Pulse task scheduler..."
Write-Host "Batch File Path: $BatchPath"

if (-not (Test-Path $BatchPath)) {
    Write-Error "Could not find run-daily.bat in the same directory! Please make sure it exists."
    exit
}

# Define the action: execute the batch file
# We run it via cmd.exe in background
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BatchPath`"" -WorkingDirectory $ScriptDir

# Define the trigger: Daily at 9:00 AM
$Trigger = New-ScheduledTaskTrigger -Daily -At 9:00AM

# Define settings: run whether plugged in or on battery, don't stop if it runs long
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register the task
try {
    # Check if task already exists and unregister it first to update
    if (Get-ScheduledTask -TaskName $ScriptName -ErrorAction SilentlyContinue) {
        Write-Host "Task '$ScriptName' already exists. Re-registering to update settings..."
        Unregister-ScheduledTask -TaskName $ScriptName -Confirm:$false
    }
    
    Register-ScheduledTask -TaskName $ScriptName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Daily AI News Aggregator and Summarizer"
    
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "SUCCESS: DailyAI-Pulse has been registered in Task Scheduler!" -ForegroundColor Green
    Write-Host "It is scheduled to run every day at 9:00 AM." -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Error registering the task: $_" -ForegroundColor Red
    Write-Host "Note: To register scheduled tasks, you may need to run this PowerShell console as Administrator." -ForegroundColor Yellow
}
