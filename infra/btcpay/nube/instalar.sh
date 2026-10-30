#!/usr/bin/env bash
# Installs the Cacao BTCPay demo stack on this VM (Ubuntu 24.04, Oracle Cloud Ampere A1, ARM64).
# Run as root, from the folder that holds this script:
#   sudo bash instalar.sh                              regtest demo, address <public-ip>.sslip.io
#   sudo bash instalar.sh --dominio pagos.example.com  regtest demo on your own domain
#   sudo bash instalar.sh --red mainnet                real bitcoin, first install on a new VM only (see LEEME.md)
# Safe to run again: it keeps the existing .env (passwords and network never change), updates the files,
# and changes the domain only when --dominio is given.
set -euo pipefail

DESTINO=/opt/cacao-btcpay
ORIGEN=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ARCHIVO_ENV="$DESTINO/.env"
RED_PEDIDA=""
DOMINIO_PEDIDO=""

uso() { echo "Uso: sudo bash instalar.sh [--red regtest|mainnet] [--dominio <host>]"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --red) RED_PEDIDA="${2:-}"; shift 2 ;;
    --dominio) DOMINIO_PEDIDO="${2:-}"; shift 2 ;;
    -h|--help) uso; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; uso >&2; exit 2 ;;
  esac
done

paso() { echo; echo "== $*"; }

# Public IPv4 of this VM as the internet sees it (the VM itself only knows its private address).
ip_publica() {
  local url ip
  for url in https://api.ipify.org https://icanhazip.com; do
    if ip=$(curl -4 -fsS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]') \
      && [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "$ip"
      return 0
    fi
  done
  return 1
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Hay que correrlo con sudo: sudo bash instalar.sh" >&2
  exit 1
fi
if [ -n "$RED_PEDIDA" ] && [ "$RED_PEDIDA" != regtest ] && [ "$RED_PEDIDA" != mainnet ]; then
  echo "--red tiene que ser regtest o mainnet." >&2
  exit 2
fi
if [ -n "$DOMINIO_PEDIDO" ] && ! [[ "$DOMINIO_PEDIDO" =~ ^[a-z0-9.-]+$ ]]; then
  echo "--dominio solo admite minúsculas, números, puntos y guiones (sin https:// ni barra)." >&2
  exit 2
fi
if [ -f /etc/os-release ]; then . /etc/os-release; fi
if [ "${ID:-}" != ubuntu ]; then
  echo "Aviso: este script está pensado para Ubuntu 24.04; este sistema es ${PRETTY_NAME:-desconocido}." >&2
fi
if [ "$(uname -m)" != aarch64 ]; then
  echo "Aviso: esta máquina es $(uname -m), no ARM64. Las imágenes también tienen build amd64, así que debería andar." >&2
fi

paso "1/7 Paquetes base y Docker Engine"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl openssl unattended-upgrades >/dev/null

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  # Docker's own apt repository (not the old docker.io package).
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<DOCKERREPO
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKERREPO
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  usermod -aG docker "$SUDO_USER"
fi

paso "2/7 Firewall del sistema: solo 22, 80 y 443"
# The Oracle Ubuntu image ships a REJECT rule for everything except 22. These rules open 80 and 443 above it.
cat > /usr/local/sbin/cacao-firewall <<'FIREWALL'
#!/usr/bin/env bash
# Opens TCP 22, 80 and 443 for new connections. The image's REJECT rule still closes every other port.
set -euo pipefail
for puerto in 22 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$puerto" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 1 -p tcp --dport "$puerto" -m conntrack --ctstate NEW -j ACCEPT
  fi
done
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  for puerto in 22 80 443; do ufw allow "$puerto/tcp" >/dev/null; done
fi
FIREWALL
chmod 755 /usr/local/sbin/cacao-firewall
cat > /etc/systemd/system/cacao-firewall.service <<'UNIT'
[Unit]
Description=Cacao: open TCP 22, 80 and 443 at boot
After=netfilter-persistent.service network-pre.target
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/cacao-firewall

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now cacao-firewall.service >/dev/null

paso "3/7 Actualizaciones de seguridad automáticas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT
cat > /etc/apt/apt.conf.d/52cacao-auto-reboot <<'APT'
// Kernel updates need a reboot. The stack starts again by itself (cacao-btcpay.service).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
APT

paso "4/7 Archivos y configuración en $DESTINO"
install -d -m 0755 "$DESTINO" "$DESTINO/billetera" "$DESTINO/respaldos"
install -m 0644 "$ORIGEN/docker-compose.nube.yml" "$DESTINO/docker-compose.yml"
install -m 0644 "$ORIGEN/Caddyfile" "$DESTINO/Caddyfile"
for archivo in servidor.mjs pagina.html recibir.html; do
  install -m 0644 "$ORIGEN/billetera/$archivo" "$DESTINO/billetera/$archivo"
done
install -m 0755 "$ORIGEN/respaldar.sh" "$DESTINO/respaldar.sh"
install -m 0755 "$ORIGEN/preparar-regtest.sh" "$DESTINO/preparar-regtest.sh"

# Settings. An existing .env is loaded first, so a re-run keeps every password and the network.
EXISTIA=0
if [ -f "$ARCHIVO_ENV" ]; then
  set -a; . "$ARCHIVO_ENV"; set +a
  EXISTIA=1
fi
if [ "$EXISTIA" = 1 ] && [ -n "$RED_PEDIDA" ] && [ "$RED_PEDIDA" != "${RED:-}" ]; then
  echo "Este servidor ya está armado para ${RED:-?}. Re-correr el script no lo pasa a $RED_PEDIDA." >&2
  echo "Cambiar de red necesita una VM nueva: ver LEEME.md, sección 'Regtest y mainnet'." >&2
  exit 1
fi
RED_FINAL=${RED_PEDIDA:-${RED:-regtest}}

DOMINIO_FINAL=${DOMINIO_PEDIDO:-${DOMINIO:-}}
if [ -z "$DOMINIO_FINAL" ]; then
  if ! ip=$(ip_publica); then
    echo "No pudimos leer la IP pública. Corré de nuevo con --dominio <host>." >&2
    exit 1
  fi
  DOMINIO_FINAL="$(echo "$ip" | tr . -).sslip.io"
fi
RPC_PASS_FINAL=${RPC_PASS:-$(openssl rand -hex 24)}

if [ "$RED_FINAL" = regtest ]; then
  CHEATMODE=true
  NODO_ESPECIFICO=txindex=1
  NODO_TARIFA=fallbackfee=0.0002
  LND_SEMILLA=noseedbackup=1
  COMPOSE_PROFILES=regtest
else
  # Mainnet: pruned node, no test buttons, no test buyer. The Lightning seed must be backed up by hand.
  CHEATMODE=false
  NODO_ESPECIFICO=prune=50000
  NODO_TARIFA=
  LND_SEMILLA=
  COMPOSE_PROFILES=
fi

umask 077
cat > "$ARCHIVO_ENV.tmp" <<ENVFILE
# Escrito por instalar.sh. Tiene secretos: no lo pegues en ningún lado.
RED=$RED_FINAL
DOMINIO=$DOMINIO_FINAL
RPC_PASS=$RPC_PASS_FINAL
CHEATMODE=$CHEATMODE
NODO_ESPECIFICO=$NODO_ESPECIFICO
NODO_TARIFA=$NODO_TARIFA
LND_SEMILLA=$LND_SEMILLA
COMPOSE_PROFILES=$COMPOSE_PROFILES
ENVFILE
mv "$ARCHIVO_ENV.tmp" "$ARCHIVO_ENV"
chmod 600 "$ARCHIVO_ENV"

# Backup key, created once. Keep a copy of it outside the VM (LEEME.md, section Respaldos).
if [ ! -s "$DESTINO/respaldo-clave" ]; then
  (umask 077; openssl rand -base64 32 > "$DESTINO/respaldo-clave")
fi
chmod 600 "$DESTINO/respaldo-clave"

cat > /etc/cron.d/cacao-btcpay-respaldo <<'CRON'
# Daily backup of the Cacao BTCPay stack. See /opt/cacao-btcpay/respaldar.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root /opt/cacao-btcpay/respaldar.sh >> /var/log/cacao-btcpay-respaldo.log 2>&1
CRON
chmod 644 /etc/cron.d/cacao-btcpay-respaldo

cat > /etc/systemd/system/cacao-btcpay.service <<'UNIT'
[Unit]
Description=Cacao BTCPay stack (docker compose in /opt/cacao-btcpay)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/cacao-btcpay
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable cacao-btcpay.service >/dev/null

paso "5/7 Arrancando el stack (la primera vez baja las imágenes: puede tardar)"
cd "$DESTINO"
docker compose pull --quiet
docker compose up -d

if [ "$RED_FINAL" = regtest ]; then
  paso "6/7 Regtest: minar, fondear al comprador de prueba y abrir el canal"
  bash "$DESTINO/preparar-regtest.sh"
else
  paso "6/7 Mainnet: no se mina ni se fondea nada. Leer LEEME.md, sección 'Regtest y mainnet'"
fi

paso "7/7 Comprobando https://$DOMINIO_FINAL"
ok=0
for _ in $(seq 1 36); do
  codigo=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMINIO_FINAL/" 2>/dev/null || true)
  if [[ "$codigo" =~ ^[23] ]]; then
    ok=1
    break
  fi
  sleep 10
done

echo
if [ "$ok" = 1 ]; then
  echo "Listo. Dirección: https://$DOMINIO_FINAL  (red: $RED_FINAL)"
else
  echo "Instalado, pero https://$DOMINIO_FINAL todavía no responde."
  echo "Revisá que los puertos 80 y 443 estén abiertos en la security list de Oracle (LEEME.md, paso 4)."
  echo "Después corré de nuevo: sudo bash instalar.sh"
  echo "Logs de HTTPS: docker compose -f $DESTINO/docker-compose.yml logs --tail=80 caddy"
fi
echo "Siguiente paso: LEEME.md (sección 'Después de instalar') y despues-de-instalar.md para el administrador."
