#!/usr/bin/env bash
# Cloned-mainnet fork proof: start surfpool (port 8899), deploy the basket .so, run fork.ts, stop surfpool and
# delete its state. Every transaction goes to the local fork; mainnet is only read (by surfpool, lazily).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
KEY="$HOME/.config/solana/stocklana/program.json"   # fork-only payer/authority here; never id.json
STATE="$(mktemp -d "${TMPDIR:-/tmp}/basket-fork.XXXXXX")"
RUN="${FORK_RUN:-$(date -u +%Y%m%dT%H%M%SZ)}"

cleanup() {
  if [[ -n "${SP:-}" ]] && kill -0 "$SP" 2>/dev/null; then
    kill -INT "$SP" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$SP" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$SP" 2>/dev/null || true
  fi
  rm -rf "$STATE"
}
trap cleanup EXIT

cd "$STATE"
surfpool start --no-tui --ci --no-deploy --no-studio -u https://api.mainnet-beta.solana.com -p 8899 \
  -k "$KEY" --log-level warn --log-path "$STATE/logs" > "$STATE/surfpool.out" 2>&1 &
SP=$!
for _ in $(seq 1 60); do
  curl -s -X POST http://127.0.0.1:8899 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | grep -q result && break
  sleep 1
done

solana program deploy --use-rpc -u http://127.0.0.1:8899 --keypair "$KEY" \
  --program-id "$ROOT/programs/basket/basket-program.keypair.json" "$ROOT/target/deploy/basket.so" | tee "$HERE/deploy-$RUN.txt"
shasum -a 256 "$ROOT/target/deploy/basket.so" | tee -a "$HERE/deploy-$RUN.txt"

cd "$ROOT/tests/program"
FORK_RUN="$RUN" node --import tsx fork/fork.ts 2>&1 | tee "$HERE/console-$RUN.txt"
