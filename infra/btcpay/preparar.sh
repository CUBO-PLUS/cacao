#!/usr/bin/env bash
# Prepares the regtest demo once the stack is up: mines coins, funds the test buyer, and opens a
# Lightning channel from the buyer to Cacao. Safe to run again: it skips what is already done.
set -euo pipefail
export MSYS_NO_PATHCONV=1
P=cacao-btcpay
cli() { docker exec "$P-bitcoind-1" bitcoin-cli -regtest -rpcport=43782 -rpcuser=cacao -rpcpassword=cacao-regtest "$@"; }
ln() { local n=$1; shift; docker exec "$P-$n-1" lncli --lnddir=/data --network=regtest "$@"; }
minar() { cli generatetoaddress "$1" "$(cli -rpcwallet=minero getnewaddress)" > /dev/null; }

cli -rpcwallet=minero getwalletinfo > /dev/null 2>&1 || cli createwallet minero > /dev/null 2>&1 || cli loadwallet minero > /dev/null
# Coinbase coins mature after 100 blocks, so 101 blocks give the miner its first spendable coins.
if [ "$(cli -rpcwallet=minero getbalance | cut -d. -f1)" -lt 2 ]; then minar 101; fi

# Funds the buyer with 1 BTC of regtest coins when it has less than 0.1.
saldo=$(ln lnd_comprador walletbalance | grep -o '"confirmed_balance": *"[0-9]*"' | grep -o '[0-9]*' | tail -1)
if [ "${saldo:-0}" -lt 10000000 ]; then
  dir=$(ln lnd_comprador newaddress p2wkh | grep -o '"address": *"[^"]*"' | cut -d'"' -f4)
  cli -rpcwallet=minero sendtoaddress "$dir" 1 > /dev/null
  minar 6
  sleep 3
fi

# Opens a channel of 5,000,000 sats from the buyer to Cacao, when none is open yet.
cacao=$(ln lnd_cacao getinfo | grep -o '"identity_pubkey": *"[^"]*"' | cut -d'"' -f4)
if ! ln lnd_comprador listchannels | grep -q "$cacao"; then
  ln lnd_comprador connect "$cacao@lnd_cacao:9735" > /dev/null 2>&1 || true
  ln lnd_comprador openchannel --node_key "$cacao" --local_amt 5000000 > /dev/null
  minar 6
  sleep 5
fi

echo "bloques: $(cli getblockcount)"
ln lnd_comprador listchannels | grep -E '"(active|capacity|local_balance|remote_balance)"'
