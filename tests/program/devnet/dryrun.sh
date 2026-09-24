#!/usr/bin/env bash
# Rehearse the devnet suite on a local solana-test-validator (RPC port 8899) with the mainnet Token-2022
# binary and the basket deploy binary preloaded. Records go to a temp dir, never to tests/program/devnet/.
# The ledger is capped and deleted afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
KEY="$HOME/.config/solana/stocklana/program.json"
STATE="$(mktemp -d "${TMPDIR:-/tmp}/basket-dry.XXXXXX")"
cleanup() { if [[ -n "${VP:-}" ]]; then kill -INT "$VP" 2>/dev/null || true; sleep 2; kill -9 "$VP" 2>/dev/null || true; fi; rm -rf "$STATE"; }
trap cleanup EXIT
solana-test-validator --reset --quiet --ledger "$STATE/ledger" --limit-ledger-size 5000000 \
  --rpc-port 8899 --faucet-port 9911 --gossip-port 8911 --dynamic-port-range 8912-8960 \
  --mint "$(solana-keygen pubkey "$KEY")" \
  --upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb "$ROOT/tests/program/fixtures/token2022.so" none \
  --upgradeable-program GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv "$ROOT/target/deploy/basket.so" none \
  > "$STATE/validator.out" 2>&1 &
VP=$!
for _ in $(seq 1 90); do curl -s -X POST http://127.0.0.1:8899 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | grep -q result && break; sleep 1; done
mkdir -p "$STATE/rec"
cd "$ROOT/tests/program"
DEVNET_RPC=http://127.0.0.1:8899 DEVNET_OUT="${DRY_OUT:-$STATE/rec}" DEVNET_SEED="dry-$(date +%s)" node --import tsx devnet/scenarios.ts "$@"
