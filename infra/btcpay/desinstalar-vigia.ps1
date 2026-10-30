# Removes the Scheduled Task "Cacao BTCPay vigia" registered by instalar-vigia.ps1.
# It stops the watcher only: the Docker stack and the tunnel keep running. Stop them with docker compose down.
# Run: powershell -ExecutionPolicy Bypass -File infra\btcpay\desinstalar-vigia.ps1

$ErrorActionPreference = 'Continue'
$nombreTarea = 'Cacao BTCPay vigia'

if (-not (Get-ScheduledTask -TaskName $nombreTarea -ErrorAction SilentlyContinue)) {
  Write-Host "La tarea '$nombreTarea' no esta registrada."
  exit 0
}
Unregister-ScheduledTask -TaskName $nombreTarea -Confirm:$false
if (Get-ScheduledTask -TaskName $nombreTarea -ErrorAction SilentlyContinue) {
  Write-Host "No se pudo quitar la tarea '$nombreTarea'."
  exit 1
}
Write-Host "Listo: se quito la tarea '$nombreTarea'."
exit 0
