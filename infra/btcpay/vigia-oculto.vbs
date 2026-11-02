' Starts vigia.ps1 with no console window: powershell.exe -WindowStyle Hidden still flashes one on each run.
' The scheduled task "Cacao BTCPay vigia" runs this file, see instalar-vigia.ps1. Waits for vigia.ps1 and returns its exit code.

Set shell = CreateObject("WScript.Shell")
Set archivos = CreateObject("Scripting.FileSystemObject")
vigia = archivos.BuildPath(archivos.GetParentFolderName(WScript.ScriptFullName), "vigia.ps1")
WScript.Quit shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & vigia & """", 0, True)
