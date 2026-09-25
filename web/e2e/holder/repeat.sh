#!/bin/bash
# Run the fresh-wallet devnet flow N times in a row against a deployed site; record each outcome.
#   N=5 E2E_BASE_URL=https://unlisted-rosy.vercel.app e2e/holder/repeat.sh
# Uses HELIUS_API_KEY from the repo's .env.local for the harness and C's scripts (never printed).
set -u
cd "$(dirname "$0")/../.."
set -a; . ../.env.local; set +a
export E2E_ENV=devnet E2E_VALUATION_URL=${E2E_VALUATION_URL:-https://valuation-production-e8f3.up.railway.app}
export E2E_RPC="https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY" DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY"
N=${N:-5}; OUT=e2e/holder/runs/repeat-$(date -u +%Y%m%dT%H%M%SZ).log
for i in $(seq 1 $N); do
  start=$(date +%s)
  if npx playwright test e2e/holder/flow.spec.ts > /tmp/repeat-run-$i.log 2>&1; then r=PASS; else r=FAIL; fi
  why=$(grep -E '^\s+Error:' /tmp/repeat-run-$i.log | head -1 | sed -E 's/api-key=[A-Za-z0-9-]+/api-key=<key>/g')
  echo "run $i/$N: $r in $(( $(date +%s) - start ))s ${why}" | tee -a $OUT
  rm -f /tmp/repeat-run-$i.log
done
echo "passed $(grep -c ': PASS' $OUT) of $N" | tee -a $OUT
