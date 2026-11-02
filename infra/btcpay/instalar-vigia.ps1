# Registers the Windows Scheduled Task "Cacao BTCPay vigia": runs vigia.ps1 hidden every 2 minutes and at logon.
# For the current user only; no administrator rights needed (RunLevel Limited).
# Run once: powershell -ExecutionPolicy Bypass -File infra\btcpay\instalar-vigia.ps1
# Undo: powershell -ExecutionPolicy Bypass -File infra\btcpay\desinstalar-vigia.ps1

$ErrorActionPreference = 'Continue'
$nombreTarea = 'Cacao BTCPay vigia'
$vigia = Join-Path $PSScriptRoot 'vigia.ps1'
$lanzador = Join-Path $PSScriptRoot 'vigia-oculto.vbs'
$usuario = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($archivo in @($vigia, $lanzador)) {
  if (-not (Test-Path $archivo)) {
    Write-Host "No encontramos $archivo."
    exit 1
  }
}

# wscript.exe has no console, so no window flashes on each run. vigia-oculto.vbs starts vigia.ps1 hidden.
$accion = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument "//B //Nologo `"$lanzador`""

# Every 2 minutes, for ten years, and again at each logon.
$cada2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$alEntrar = New-ScheduledTaskTrigger -AtLogOn -User $usuario

$ajustes = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

# Interactive: Docker Desktop runs in the user's session. Limited: no administrator rights.
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombreTarea -Action $accion -Trigger @($cada2, $alEntrar) `
  -Settings $ajustes -Principal $principal -Description 'Keeps the Cacao BTCPay demo running and its public address current in Supabase.' `
  -Force | Out-Null

if (Get-ScheduledTask -TaskName $nombreTarea -ErrorAction SilentlyContinue) {
  Write-Host "Listo: la tarea '$nombreTarea' corre cada 2 minutos y al entrar, para $usuario."
  Write-Host 'Su registro queda en infra\btcpay\local\vigia.log.'
  exit 0
}
Write-Host "No se pudo registrar la tarea '$nombreTarea'."
exit 1
