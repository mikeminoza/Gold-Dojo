@echo off
title Gold history download
cd /d "%~dp0.."
.venv\Scripts\python -m research.dukascopy --workers 2 --gap 1
echo.
echo Finished. Close this window.
pause
