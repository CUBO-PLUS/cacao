# Turns on the monthly plan charge of CacaoLedger in production. Prints no key.
#   1. Applies the pending Supabase migrations (ledger_planes, ledger_cuotas).
#   2. Creates a CacaoPay API client for Ledger (product "pay": the due is Grupo Cacao's own revenue), on the same
#      BTCPay store the other products charge with.
#   3. Stores CACAO_PAY_URL and CACAO_PAY_API_KEY in the Ledger project on Vercel.
# Then deploy Ledger: cd ledger && npx vercel deploy --prod --yes
# Run: powershell -ExecutionPolicy Bypass -File infra\btcpay\activar-planes-ledger.ps1
$ErrorActionPreference = 'Stop'
$raiz = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
foreach ($linea in Get-Content "$raiz\market\.env.nube") {
  if ($linea -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { Set-Item -Path ("env:" + $Matches[1]) -Value ($Matches[2].Trim('"')) }
}

Write-Host '1/3 Subiendo migraciones...'
Push-Location "$raiz\market"
npx supabase db push --project-ref $env:SUPABASE_PROJECT_REF -p $env:SUPABASE_DB_PASSWORD --yes
$fallo = $LASTEXITCODE
Pop-Location
if ($fallo -ne 0) { Write-Host 'Fallo db push.'; exit 1 }

Write-Host '2/3 Creando la clave de Ledger en CacaoPay...'
$h = @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)" }
$clientes = @(Invoke-RestMethod -Uri "$($env:NEXT_PUBLIC_SUPABASE_URL)/rest/v1/pay_api_clientes?select=nombre,producto,tienda_btcpay&revocado_en=is.null&producto=in.(media,travel,market)" -Headers $h | ForEach-Object { $_ })
if ($clientes.Count -eq 0) { Write-Host 'No encontre la tienda de BTCPay de los otros productos.'; exit 1 }
$tienda = $clientes[0].tienda_btcpay
Push-Location "$raiz\pay"
$salida = node scripts/cliente-api.mjs crear --nombre "Ledger planes" --producto pay --tienda $tienda 2>&1 | Out-String
Pop-Location
$clave = [regex]::Match($salida, 'cp_[A-Za-z0-9_-]{20,}').Value
if (-not $clave) { Write-Host 'No se creo la clave:'; Write-Host ($salida -replace 'cp_[A-Za-z0-9_-]+', 'cp_***'); exit 1 }
Write-Host 'Clave creada (no se muestra).'

Write-Host '3/3 Guardando la configuracion en Vercel (proyecto de Ledger)...'
Push-Location "$raiz\ledger"
foreach ($nombre in 'CACAO_PAY_URL', 'CACAO_PAY_API_KEY') { npx vercel env rm $nombre production --yes 2>$null | Out-Null }
'https://cacao-pay.vercel.app' | npx vercel env add CACAO_PAY_URL production | Out-Null
$clave | npx vercel env add CACAO_PAY_API_KEY production | Out-Null
$fallo = $LASTEXITCODE
Pop-Location
if ($fallo -ne 0) { Write-Host 'No se pudo guardar la clave en Vercel.'; exit 1 }
Write-Host 'Listo. Ahora desplega Ledger: cd ledger && npx vercel deploy --prod --yes'
