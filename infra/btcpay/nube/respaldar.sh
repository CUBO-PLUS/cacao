#!/usr/bin/env bash
# Daily backup of the Cacao BTCPay stack. Run by cron (/etc/cron.d/cacao-btcpay-respaldo) at 03:17 UTC.
# One encrypted file per run in /opt/cacao-btcpay/respaldos. Files older than 7 days are deleted.
# What goes in:
#  - postgres: every database (BTCPay and NBXplorer), as SQL.
#  - lnd_cacao channel.backup: lets you recover channel funds if the node's data is lost.
#  - the BTCPay data directory (keys and settings).
# Encryption: openssl AES-256, key in /opt/cacao-btcpay/respaldo-clave. Without that key nothing can be read,
# so copy the key to a safe place once. Copy the archives off the VM too: a backup on the same disk is not a backup.
set -euo pipefail

DESTINO=/opt/cacao-btcpay
P=cacao-btcpay
DIR_RESPALDOS="$DESTINO/respaldos"
CLAVE="$DESTINO/respaldo-clave"
DIAS_A_GUARDAR=7

set -a; . "$DESTINO/.env"; set +a
if [ ! -s "$CLAVE" ]; then
  echo "Falta la clave de respaldo: $CLAVE (corré instalar.sh de nuevo)." >&2
  exit 1
fi
install -d -m 0755 "$DIR_RESPALDOS"

TRABAJO=$(mktemp -d)
trap 'rm -rf "$TRABAJO"' EXIT
fecha=$(date -u +%Y%m%d-%H%M)
archivo="$DIR_RESPALDOS/cacao-btcpay-$fecha.tar.gz.enc"
echo "[$(date -u +%FT%TZ)] respaldo $fecha ($RED)"

# 1. Postgres: BTCPay and NBXplorer databases.
docker exec "$P-postgres-1" pg_dumpall -U postgres | gzip > "$TRABAJO/postgres.sql.gz"

# 2. Lightning channel backup. LND rewrites this file by itself whenever a channel changes.
docker cp "$P-lnd_cacao-1:/data/data/chain/bitcoin/$RED/channel.backup" "$TRABAJO/channel.backup" \
  || echo "Aviso: todavía no hay channel.backup (no hay canales abiertos)." >&2

# 3. BTCPay data directory, read-only, packed inside the backup.
docker run --rm --entrypoint tar \
  -v "${P}_btcpay_datadir:/datos:ro" -v "$TRABAJO:/respaldo" \
  postgres:16.4 czf /respaldo/btcpay-datadir.tar.gz -C /datos .

# 4. One encrypted archive. Written as .tmp first, so a failed run never leaves a half file behind.
tar czf - -C "$TRABAJO" . \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$CLAVE" -out "$archivo.tmp"
mv "$archivo.tmp" "$archivo"
chmod 644 "$archivo"

# 5. Rotation: keep the last 7 days.
find "$DIR_RESPALDOS" -maxdepth 1 -name 'cacao-btcpay-*.tar.gz.enc' -mtime +"$DIAS_A_GUARDAR" -print -delete

echo "listo: $archivo ($(du -h "$archivo" | cut -f1))"
