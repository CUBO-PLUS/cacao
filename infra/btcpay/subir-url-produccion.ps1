# Applies the pending Supabase migrations to production and stores the current public BTCPay address there,
# so the five products read it at run time. Reads the keys from market\.env.nube without printing them.
# Run: powershell -ExecutionPolicy Bypass -File infra\btcpay\subir-url-produccion.ps1
$ErrorActionPreference = 'Continue'
$raiz = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
foreach ($linea in Get-Content "$raiz\market\.env.nube") {
  if ($linea -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { Set-Item -Path ("env:" + $Matches[1]) -Value ($Matches[2].Trim('"')) }
}

Write-Host '1/2 Subiendo migraciones...'
Push-Location "$raiz\market"
npx supabase db push --project-ref $env:SUPABASE_PROJECT_REF -p $env:SUPABASE_DB_PASSWORD --yes
$fallo = $LASTEXITCODE
Pop-Location
if ($fallo -ne 0) { Write-Host 'Fallo db push.'; exit 1 }

Write-Host '2/2 Guardando la direccion de BTCPay...'
$url = (Get-Content "$raiz\.qa\btcpay-local.json" -Raw | ConvertFrom-Json).urlPublica
$h = @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)" }
try {
  $r = Invoke-RestMethod -Method Post -Uri "$($env:NEXT_PUBLIC_SUPABASE_URL)/rest/v1/rpc/fijar_url_btcpay" -Headers $h -ContentType 'application/json' -Body (@{ p_url = $url } | ConvertTo-Json)
  Write-Host "Direccion guardada: $r"
} catch { Write-Host "No se pudo guardar la direccion: $($_.Exception.Message)"; exit 1 }
Write-Host 'Listo.'
