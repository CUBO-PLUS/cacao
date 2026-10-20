# Opens a public address for the demo's front door (test wallet + BTCPay) with a Cloudflare quick tunnel.
# Free, no account. The address changes every time the tunnel starts.
# Run: powershell -ExecutionPolicy Bypass -File infra\btcpay\tunel.ps1
# If an antivirus inspects TLS, put a CA bundle with its root in infra\btcpay\local\cas.pem (git ignores local\).

# Docker writes notices to stderr, and Windows PowerShell 5.1 treats them as errors. Exit codes decide instead.
$ErrorActionPreference = 'Continue'
$local = Join-Path $PSScriptRoot 'local'
$cas = ''
if (Test-Path (Join-Path $local 'cas.pem')) {
  $cas = "-v `"${local}:/etc/cacao-local:ro`" -e SSL_CERT_FILE=/etc/cacao-local/cas.pem"
}
cmd /c "docker rm -f cacao-tunel >nul 2>&1"
cmd /c "docker run -d --name cacao-tunel --network cacao-btcpay_default --restart unless-stopped $cas cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://puerta:8088 >nul"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el tunel. Docker Desktop esta abierto?' }
Write-Host 'Esperando la direccion...'
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep 2
  # The tunnel address is a random name; api.trycloudflare.com is only the service that hands it out.
  $m = docker logs cacao-tunel 2>&1 | ForEach-Object { "$_" } |
    Select-String -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
  if ($m) {
    $u = $m.Matches[0].Value
    Write-Host "Direccion publica: $u"
    Write-Host "Billetera de prueba: $u/billetera"
    Write-Host 'Listo.'
    exit 0
  }
}
Write-Host 'No aparecio la direccion. Ultimas lineas del tunel:'
docker logs cacao-tunel --tail 5 2>&1 | ForEach-Object { "$_" }
exit 1
