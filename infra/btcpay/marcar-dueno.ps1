# Marks one account as owner of CacaoLedger (usuarios.es_admin) and shows the last Ledger syncs with their errors.
# Reads the keys from market\.env.nube without printing them. Asks which account before changing anything.
# Run: powershell -ExecutionPolicy Bypass -File infra\btcpay\marcar-dueno.ps1
$ErrorActionPreference = 'Stop'
$raiz = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
foreach ($linea in Get-Content "$raiz\market\.env.nube") {
  if ($linea -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { Set-Item -Path ("env:" + $Matches[1]) -Value ($Matches[2].Trim('"')) }
}
$base = "$($env:NEXT_PUBLIC_SUPABASE_URL)/rest/v1"
$h = @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)" }

# Windows PowerShell 5.1 hands a JSON array over as one object, so it is unrolled through the pipeline.
$usuarios = @(Invoke-RestMethod -Uri "$base/usuarios?select=id,nombre,es_admin,creado_en&clerk_id=not.is.null&order=creado_en.desc&limit=8" -Headers $h | ForEach-Object { $_ })
if ($usuarios.Count -eq 0) { Write-Host 'No hay cuentas de Clerk en produccion.'; exit 1 }

Write-Host 'Cuentas mas recientes:'
for ($i = 0; $i -lt $usuarios.Count; $i++) {
  $u = $usuarios[$i]
  Write-Host ("  {0}) {1}  creada {2}  dueno={3}" -f ($i + 1), $u.nombre, $u.creado_en, $u.es_admin)
}
$respuesta = Read-Host 'Numero de tu cuenta (Enter para no cambiar nada)'
if ($respuesta -match '^\d+$' -and [int]$respuesta -ge 1 -and [int]$respuesta -le $usuarios.Count) {
  $elegido = $usuarios[[int]$respuesta - 1]
  $null = Invoke-RestMethod -Method Patch -Uri "$base/usuarios?id=eq.$($elegido.id)" -Headers $h -ContentType 'application/json' -Body '{"es_admin":true}'
  Write-Host "Listo: $($elegido.nombre) ya es dueno."
} else {
  Write-Host 'No cambie ninguna cuenta.'
}

Write-Host ''
Write-Host 'Ultimas sincronizaciones de Ledger:'
$sinc = @(Invoke-RestMethod -Uri "$base/ledger_sincronizaciones?select=empezo,nuevas,error&order=empezo.desc&limit=4" -Headers $h | ForEach-Object { $_ })
foreach ($s in $sinc) {
  $detalle = if ($s.error) { $s.error } else { 'bien' }
  Write-Host ("  {0}  nuevas={1}  {2}" -f $s.empezo, $s.nuevas, $detalle)
}
Write-Host 'Listo.'
