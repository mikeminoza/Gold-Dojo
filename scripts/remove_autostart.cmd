@echo off
rem Golden Skibidi: stop starting the bot automatically at sign-in (doesn't stop a running bot).
set LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Golden Skibidi bot.lnk
if exist "%LINK%" (del "%LINK%" & echo Auto-start removed.) else (echo Auto-start was not installed.)
