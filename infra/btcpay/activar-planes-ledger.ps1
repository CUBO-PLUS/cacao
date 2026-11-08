# Turns on the monthly plan charge of CacaoLedger in production. Prints no key.
#   1. Applies the pending Supabase migrations (ledger_planes, ledger_cuotas).
#   2. Creates a CacaoPay API client for Ledger (product "pay": the due is Grupo Cacao's own revenue), on the same
#      BTCPay store the other products charge with.
#   3. Stores CACAO_PAY_URL and CACAO_PAY_API_KEY in the Ledger project on Vercel.
# Safe to run again: it revokes any earlier "Ledger planes" key before creating a new one.
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
# A key from an earlier run is never shown, so it cannot be reused: revoke it and make a new one.
$viejas = @(Invoke-RestMethod -Uri "$($env:NEXT_PUBLIC_SUPABASE_URL)/rest/v1/pay_api_clientes?select=prefijo&nombre=eq.Ledger%20planes&revocado_en=is.null" -Headers $h | ForEach-Object { $_ })
foreach ($v in $viejas) {
  $null = Invoke-RestMethod -Method Post -Uri "$($env:NEXT_PUBLIC_SUPABASE_URL)/rest/v1/rpc/pay_revocar_cliente_api" -Headers $h -ContentType 'application/json' -Body (@{ p_prefijo = $v.prefijo } | ConvertTo-Json)
}
if ($viejas.Count -gt 0) { Write-Host "Clave anterior revocada ($($viejas.Count))." }
Push-Location "$raiz\pay"
$salida = node scripts/cliente-api.mjs crear --nombre "Ledger planes" --producto pay --tienda $tienda 2>&1 | Out-String
Pop-Location
$clave = [regex]::Match($salida, 'cp_[A-Za-z0-9_-]{20,}').Value
if (-not $clave) { Write-Host 'No se creo la clave:'; Write-Host ($salida -replace 'cp_[A-Za-z0-9_-]+', 'cp_***'); exit 1 }
Write-Host 'Clave creada (no se muestra).'

Write-Host '3/3 Guardando la configuracion en Vercel (proyecto de Ledger)...'
# Vercel writes its banner to stderr, which Windows PowerShell 5.1 turns into an error: run it through cmd instead.
# The values go through a temporary file that is deleted right after, never through the command line.
Push-Location "$raiz\ledger"
$tmp = [System.IO.Path]::GetTempFileName()
$fallo = 0
try {
  foreach ($par in @(@('CACAO_PAY_URL', 'https://cacao-pay.vercel.app'), @('CACAO_PAY_API_KEY', $clave))) {
    cmd /c "npx vercel env rm $($par[0]) production --yes >nul 2>nul"
    [System.IO.File]::WriteAllText($tmp, $par[1])
    cmd /c "npx vercel env add $($par[0]) production < `"$tmp`" >nul 2>nul"
    if ($LASTEXITCODE -ne 0) { $fallo = 1; Write-Host "No se pudo guardar $($par[0]) en Vercel." }
    else { Write-Host "$($par[0]) guardada." }
  }
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Pop-Location
}
if ($fallo -ne 0) { exit 1 }
Write-Host 'Listo. Ahora desplega Ledger: cd ledger && npx vercel deploy --prod --yes'
