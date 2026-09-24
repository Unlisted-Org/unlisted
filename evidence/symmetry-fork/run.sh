#!/usr/bin/env bash
# Starts a fresh surfpool mainnet fork for each scenario, runs it, stops the fork.
# Requires surfpool (tested with 0.12.0) and node >= 20. Nothing is sent to mainnet.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
[ -d node_modules ] || npm install --silent
DATASOURCE="${DATASOURCE:-https://api.mainnet-beta.solana.com}"
for scenario in baseline pause seize; do
  surfpool start --no-tui --ci -u "$DATASOURCE" -p 8899 > "out/surfpool-$scenario.log" 2>&1 &
  pid=$!
  until curl -s localhost:8899 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | grep -q result; do sleep 1; done
  node repro.js "$scenario"
  kill -INT "$pid" 2>/dev/null || true; sleep 2; kill -9 "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
done
