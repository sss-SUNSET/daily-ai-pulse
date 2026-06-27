@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
echo Starting DailyAI Pulse Aggregator...
node scripts/aggregate.js >> logs/cron.log 2>&1
echo Done.
