@echo off
rem Golden Skibidi: start the bot automatically whenever you sign in to Windows.
rem Adds "Golden Skibidi bot" to your Startup folder; remove_autostart.cmd takes it out again.
set LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Golden Skibidi bot.lnk
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%~dp0start_bot_hidden.vbs\"'; $s.WorkingDirectory = '%~dp0..'; $s.Description = 'Golden Skibidi signal bot'; $s.Save()"
if exist "%LINK%" (echo Auto-start installed: the bot will start when you sign in.) else (echo Could not create the Startup item.)
