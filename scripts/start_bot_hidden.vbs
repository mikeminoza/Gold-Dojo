' Golden Skibidi: starts scripts\start_bot.cmd with no window (used by the Windows Startup item).
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /c """ & here & "\start_bot.cmd""", 0, False
