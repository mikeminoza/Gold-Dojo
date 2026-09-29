@echo off
rem Golden Skibidi: stops the bot started by start_bot.cmd (it won't be restarted).
cd /d "%~dp0.."
if not exist bot.pid (
  echo No bot is running.
  goto :eof
)
if not exist logs mkdir logs
echo stop> logs\stop.flag
set /p PID=<bot.pid
taskkill /PID %PID% /F >nul 2>&1 && echo Bot stopped. || echo The bot was not running.
del bot.pid >nul 2>&1
