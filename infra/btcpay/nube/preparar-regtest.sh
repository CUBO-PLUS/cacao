#!/usr/bin/env bash
# Regtest demo only. Waits for the nodes, mines coins, funds the test buyer with 1 BTC of regtest coins and
# opens a 5,000,000-sat Lightning channel from the buyer to Cacao. Safe to run again: it skips what is done.
# Run by instalar.sh. By hand: sudo bash /opt/cacao-btcpay/preparar-regtest.sh
set -euo pipefail

DESTINO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
set -a; . "$DESTINO/.env"; set +a
if [ "${RED:-}" != regtest ]; then
  echo "Este script es solo para regtest (RED=${RED:-sin definir})." >&2
  exit 1
fi

P=cacao-btcpay
cli() { docker exec "$P-bitcoind-1" bitcoin-cli -regtest -rpcport=43782 -rpcuser=cacao -rpcpassword="$RPC_PASS" "$@"; }
lnc() { local nodo=$1; shift; docker exec "$P-$nodo-1" lncli --lnddir=/data --network=regtest "$@"; }
minar() { cli generatetoaddress "$1" "$(cli -rpcwallet=minero getnewaddress)" >/dev/null; }
# Reads the value of a quoted JSON field from lncli output on stdin: campo <name>
campo() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | tail -1; }

# Waits up to 5 minutes for a command to succeed: esperar <node> <command...>
esperar() {
  local nodo=$1; shift
  for _ in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  echo "$nodo no responde después de 5 minutos. Mirá: docker logs $P-$nodo-1" >&2
  exit 1
}

esperar bitcoind cli getblockchaininfo
esperar lnd_cacao lnc lnd_cacao getinfo
esperar lnd_comprador lnc lnd_comprador getinfo

if ! cli -rpcwallet=minero getwalletinfo >/dev/null 2>&1; then
  cli createwallet minero >/dev/null 2>&1 || cli loadwallet minero >/dev/null
fi
# Coinbase coins mature after 100 blocks, so 101 blocks give the miner its first spendable coins.
entero=$(cli -rpcwallet=minero getbalance | cut -d. -f1)
if [ "$entero" -lt 2 ]; then minar 101; fi

# Funds the buyer with 1 BTC of regtest coins when it has less than 0.1 BTC.
saldo() { lnc lnd_comprador walletbalance | campo confirmed_balance; }
s=$(saldo)
if [ "${s:-0}" -lt 10000000 ]; then
  direccion=$(lnc lnd_comprador newaddress p2wkh | campo address)
  cli -rpcwallet=minero sendtoaddress "$direccion" 1 >/dev/null
  minar 6
  for _ in $(seq 1 30); do
    s=$(saldo)
    if [ "${s:-0}" -ge 100000000 ]; then break; fi
    sleep 2
  done
fi

# Opens a channel of 5,000,000 sats from the buyer to Cacao, when none is open yet.
cacao=$(lnc lnd_cacao getinfo | campo identity_pubkey)
if [ -z "$cacao" ]; then
  echo "No pudimos leer la clave pública de lnd_cacao." >&2
  exit 1
fi
canales=$(lnc lnd_comprador listchannels)
if ! grep -q "$cacao" <<<"$canales"; then
  lnc lnd_comprador connect "$cacao@lnd_cacao:9735" >/dev/null 2>&1 || true
  lnc lnd_comprador openchannel --node_key "$cacao" --local_amt 5000000 >/dev/null
  minar 6
  for _ in $(seq 1 30); do
    canales=$(lnc lnd_comprador listchannels)
    if grep -q '"active": true' <<<"$canales"; then break; fi
    sleep 2
  done
fi

echo "bloques: $(cli getblockcount)"
lnc lnd_comprador listchannels | grep -E '"(active|capacity|local_balance|remote_balance)"' || true
