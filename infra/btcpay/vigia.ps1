# Keeps the BTCPay demo alive and publishes its current public address in Supabase, so the products
# find it at run time. Runs every 2 minutes and at logon (scheduled task "Cacao BTCPay vigia", see instalar-vigia.ps1).
# Can also run by hand: powershell -ExecutionPolicy Bypass -File infra\btcpay\vigia.ps1
# Exit 0 when everything is healthy. Keys are read from the env files into variables and never printed or logged.
# Windows PowerShell 5.1: Docker writes notices to stderr, so exit codes decide, not error records.

$ErrorActionPreference = 'Continue'
$carpeta = $PSScriptRoot
$raiz = Split-Path -Parent (Split-Path -Parent $carpeta)
$compose = Join-Path $carpeta 'docker-compose.yml'
$local = Join-Path $carpeta 'local'
$registro = Join-Path $local 'vigia.log'
$cas = Join-Path $local 'cas.pem'
$qaArchivo = Join-Path $raiz '.qa\btcpay-local.json'
$envNube = Join-Path $raiz 'market\.env.nube'
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$utf8 = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path $local)) { New-Item -ItemType Directory -Path $local | Out-Null }

# One run at a time: a run that waits for Docker must not be overlapped by the next scheduled run.
$candado = New-Object -TypeName System.Threading.Mutex -ArgumentList $false, 'Local\CacaoBtcpayVigia'
$propio = $false
try {
  $propio = $candado.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  # A run that was killed left the mutex behind: this run owns it now.
  $propio = $true
} catch {
  $propio = $false
}
if (-not $propio) { exit 0 }

function Registrar([string]$linea) {
  $marca = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $texto = "$marca $linea" + [Environment]::NewLine
  [System.IO.File]::AppendAllText($registro, $texto, $utf8)
  # Keep the log short: the last 2000 lines when it grows past 1 MB.
  if ((Get-Item $registro).Length -gt 1MB) {
    $ultimas = Get-Content -Path $registro -Tail 2000
    [System.IO.File]::WriteAllText($registro, (($ultimas -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)
  }
}

function DockerListo {
  cmd /c "docker info >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

function UrlDelTunel {
  # The tunnel address is a random name; api.trycloudflare.com is only the service that hands it out.
  $salida = cmd /c "docker logs cacao-tunel 2>&1"
  $texto = ($salida | ForEach-Object { "$_" }) -join "`n"
  $coincidencias = [regex]::Matches($texto, 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com')
  if ($coincidencias.Count -gt 0) { return $coincidencias[$coincidencias.Count - 1].Value }
  return $null
}

function LeerEnv([string]$ruta) {
  $mapa = @{}
  if (-not (Test-Path $ruta)) { return $mapa }
  foreach ($linea in Get-Content -Path $ruta) {
    if ($linea -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $nombre = $matches[1]
      $valor = $matches[2]
      if ($valor -match '^"(.*)"$') { $valor = $matches[1] }
      $mapa[$nombre] = $valor
    }
  }
  return $mapa
}

$dockerOk = $false
$stackOk = $false
$tunelOk = $false
$urlCambio = 'no'
$supabaseOk = $false
$url = $null
$motivo = ''

try {
  # (a) Docker Desktop: start it when the engine does not answer, and wait up to 4 minutes.
  $dockerOk = DockerListo
  if (-not $dockerOk -and (Test-Path $dockerDesktop)) {
    Start-Process -FilePath $dockerDesktop
    $limite = (Get-Date).AddMinutes(4)
    while (-not $dockerOk -and (Get-Date) -lt $limite) {
      Start-Sleep -Seconds 5
      $dockerOk = DockerListo
    }
  }
  if (-not $dockerOk) {
    $motivo = 'docker no responde (ver README, "Mantenerlo vivo")'
    throw $motivo
  }

  # (b) The stack. Compose reads infra/btcpay/.env by itself; up -d changes nothing when it is already running.
  cmd /c "docker compose -f `"$compose`" up -d >nul 2>&1"
  $stackOk = ($LASTEXITCODE -eq 0)
  if (-not $stackOk) {
    $motivo = 'docker compose up fallo'
    throw $motivo
  }

  # bitcoind writes its chain index to disk only on a clean shutdown or hourly while blocks arrive. A Docker
  # crash once rolled the regtest chain back to block 101. gettxoutsetinfo forces the write on every run.
  cmd /c "docker exec cacao-btcpay-bitcoind-1 bitcoin-cli -regtest -rpcport=43782 -rpcuser=cacao -rpcpassword=cacao-regtest gettxoutsetinfo >nul 2>&1"

  # (c) The tunnel container: create it when missing or stopped, same as tunel.ps1.
  $corriendo = (cmd /c "docker inspect -f {{.State.Running}} cacao-tunel 2>nul") -join ''
  if ($corriendo.Trim() -ne 'true') {
    cmd /c "docker rm -f cacao-tunel >nul 2>&1"
    $casArgs = ''
    if (Test-Path $cas) { $casArgs = "-v `"${local}:/etc/cacao-local:ro`" -e SSL_CERT_FILE=/etc/cacao-local/cas.pem" }
    cmd /c "docker run -d --name cacao-tunel --network cacao-btcpay_default --restart unless-stopped $casArgs cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://puerta:8088 >nul 2>&1"
    if ($LASTEXITCODE -ne 0) {
      $motivo = 'no se pudo crear el tunel'
      throw $motivo
    }
  }

  # (d) The current address, and a health check through it. The tunnel needs a few seconds to hand out its name.
  for ($i = 0; $i -lt 15 -and -not $url; $i++) {
    $url = UrlDelTunel
    if (-not $url) { Start-Sleep -Seconds 2 }
  }
  if (-not $url) {
    $motivo = 'el tunel todavia no tiene direccion'
    throw $motivo
  }
  try {
    $salud = Invoke-WebRequest -Uri "$url/api/v1/health" -UseBasicParsing -TimeoutSec 15
    $tunelOk = ($salud.StatusCode -eq 200)
  } catch {
    $tunelOk = $false
  }
  if (-not $tunelOk) {
    $motivo = 'BTCPay no responde por el tunel'
    throw $motivo
  }

  # (e) Supabase: compare with the stored address and publish the new one. Only healthy addresses are published.
  $nube = LeerEnv $envNube
  $base = ([string]$nube['NEXT_PUBLIC_SUPABASE_URL']).Trim().TrimEnd('/')
  $clave = ([string]$nube['SUPABASE_SERVICE_ROLE_KEY']).Trim()
  if (-not $base -or -not $clave) {
    $motivo = 'faltan las claves de Supabase en market/.env.nube'
    throw $motivo
  }
  $cabeceras = @{ apikey = $clave; Authorization = "Bearer $clave" }
  $guardada = Invoke-RestMethod -Method Post -Uri "$base/rest/v1/rpc/url_btcpay" -Headers $cabeceras -ContentType 'application/json' -Body '{}' -TimeoutSec 10
  if ($guardada -ne $url) {
    $urlCambio = 'si'
    $cuerpo = ConvertTo-Json -InputObject @{ p_url = $url } -Compress
    $null = Invoke-RestMethod -Method Post -Uri "$base/rest/v1/rpc/fijar_url_btcpay" -Headers $cabeceras -ContentType 'application/json' -Body $cuerpo -TimeoutSec 10
  }
  $supabaseOk = $true

  # Keep the local record of the demo in step (the products do not read it; it is for the operator).
  if (Test-Path $qaArchivo) {
    $qa = Get-Content -Raw -Path $qaArchivo | ConvertFrom-Json
    if ($qa.urlPublica -ne $url) {
      $qa | Add-Member -NotePropertyName urlPublica -NotePropertyValue $url -Force
      [System.IO.File]::WriteAllText($qaArchivo, ((ConvertTo-Json -InputObject $qa -Depth 20) + [Environment]::NewLine), $utf8)
    }
  }
} catch {
  if (-not $motivo) { $motivo = 'error inesperado: ' + $_.Exception.Message }
  Write-Host "Vigia: $motivo"
}

$ok = $dockerOk -and $stackOk -and $tunelOk -and $supabaseOk
$resumen = "docker={0} stack={1} tunel={2} supabase={3} url={4} url_cambio={5}" -f `
  ($dockerOk -as [string]).ToLower(), ($stackOk -as [string]).ToLower(), ($tunelOk -as [string]).ToLower(), `
  ($supabaseOk -as [string]).ToLower(), $(if ($url) { $url } else { '-' }), $urlCambio
if ($motivo) { $resumen = "$resumen motivo=`"$motivo`"" }
try { Registrar $resumen } catch { }

if ($propio) { $candado.ReleaseMutex() }
if ($ok) { Write-Host "BTCPay listo: $url"; exit 0 }
exit 1
