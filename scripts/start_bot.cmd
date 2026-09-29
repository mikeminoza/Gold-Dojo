@echo off
rem Golden Skibidi: runs the signal bot and restarts it if it ever crashes.
rem Output goes to logs\bot.log. Stop it with scripts\stop_bot.cmd.
cd /d "%~dp0.."
if not exist logs mkdir logs
if exist logs\stop.flag del logs\stop.flag

:loop
rem keep the log from growing forever: roll it over at about 5 MB
for %%F in (logs\bot.log) do if %%~zF GTR 5000000 move /y logs\bot.log logs\bot.old.log >nul
echo [%date% %time%] starting bot>> logs\bot.log
".venv\Scripts\python.exe" -u bot.py >> logs\bot.log 2>&1
set CODE=%errorlevel%
if exist logs\stop.flag goto stopped
if %CODE% equ 3 (
  echo [%date% %time%] another bot is already running, so this one did not start>> logs\bot.log
  goto :eof
)
echo [%date% %time%] bot stopped unexpectedly ^(exit code %CODE%^); restarting in 30 seconds>> logs\bot.log
timeout /t 30 /nobreak >nul
if exist logs\stop.flag goto stopped
goto loop

:stopped
del logs\stop.flag
echo [%date% %time%] bot stopped by stop_bot.cmd>> logs\bot.log
