#!/usr/bin/env bash
# Build and stand up the whole fixture environment on a cluster, in dependency order.
#   scripts/bootstrap.sh local|devnet
# Steps are idempotent where the chain allows (create-mints resumes from the registry; seed-pools
# skips existing pools). Keys: ~/.config/solana/stocklana/ only.
set -euo pipefail
CLUSTER="${1:?usage: scripts/bootstrap.sh local|devnet}"
case "$CLUSTER" in local|devnet) ;; *) echo "refusing cluster $CLUSTER" >&2; exit 1 ;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYS="$HOME/.config/solana/stocklana"
CFG="$KEYS/cli-ops-$CLUSTER.yml"
URL=$([ "$CLUSTER" = local ] && echo "http://127.0.0.1:8901" || echo "https://api.devnet.solana.com")
printf -- "---\njson_rpc_url: %s\nwebsocket_url: ''\nkeypair_path: %s\ncommitment: confirmed\n" "$URL" "$KEYS/fixture-issuer.json" > "$CFG"

ISSUER=$(solana-keygen pubkey "$KEYS/fixture-issuer.json"); OPS=$(solana-keygen pubkey "$KEYS/ops.json")
if [ "$CLUSTER" = local ]; then
  solana -C "$CFG" airdrop 100 "$ISSUER" >/dev/null; solana -C "$CFG" airdrop 50 "$OPS" >/dev/null
else
  # The issuer pays for fixture transactions; top it up from the ops key (never from any other key).
  BAL=$(solana -C "$CFG" balance "$ISSUER" | awk '{print $1}')
  if awk "BEGIN{exit !($BAL < ${ISSUER_MIN_SOL:-0.25})}"; then
    solana -C "$CFG" transfer "$ISSUER" "${ISSUER_TOPUP_SOL:-0.3}" --from "$KEYS/ops.json" --fee-payer "$KEYS/ops.json" --allow-unfunded-recipient
  fi
fi
(cd "$ROOT/fixtures" && cargo build-sbf --manifest-path amm/Cargo.toml && cargo build-sbf --manifest-path hook/Cargo.toml)
for p in amm hook; do
  ID=$(solana-keygen pubkey "$KEYS/fixture-$p-program.json")
  if solana -C "$CFG" program show "$ID" >/dev/null 2>&1; then echo "fixture_$p $ID already deployed"; else
    solana -C "$CFG" program deploy "$ROOT/fixtures/target/deploy/fixture_$p.so" --program-id "$KEYS/fixture-$p-program.json" \
      --keypair "$KEYS/ops.json" --upgrade-authority "$KEYS/ops.json" --max-sign-attempts 50
  fi
done
cd "$ROOT"
node scripts/fixtures/create-mints.ts --cluster "$CLUSTER"
node scripts/fixtures/diff.ts --cluster "$CLUSTER" || true
node scripts/amm/seed-pools.ts --cluster "$CLUSTER"
node scripts/amm/swap-test.ts --cluster "$CLUSTER" --usdc 50
node scripts/scenarios/issuer.ts standin-vaults --cluster "$CLUSTER"
