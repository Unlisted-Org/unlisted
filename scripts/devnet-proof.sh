#!/usr/bin/env bash
# Everything that needs devnet SOL, in order, once the ops key is funded:
#   scripts/devnet-proof.sh
# 1. fixtures (mints, USDC, fixture_amm, hook, pools, stand-in vaults) via bootstrap.sh
# 2. fixtures/DIFF.md from live reads (mainnet + devnet)
# 3. stand-in basket (until A's program is on devnet)
# 4. every issuer scenario with signed devnet transactions, against stand-in vaults
#    (each change is reversed afterwards so the fixtures keep mirroring mainnet)
# 5. API acceptance checks against devnet
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
C="--cluster devnet"
scripts/bootstrap.sh devnet
node scripts/fixtures/diff.ts $C
node scripts/fixtures/standin-basket.ts $C
vault() { node -e "const r=require('./fixtures/registry.json');console.log(r.standin_vaults.vaults.find(v=>v.symbol==='$1').vault)"; }
S=scripts/scenarios/issuer.ts
node $S seize      $C --vault "$(vault ANDURIL)" --bps 1000
node $S pause      $C --vault "$(vault KALSHI)"
node $S resume     $C --vault "$(vault KALSHI)"
# 100 -> 300 bps as PreStocks did on 2026-09-24. Run in the creation epoch, so the mirrored schedule
# (older 100, newer 300 two epochs out) is unchanged; activation is checked later with --wait.
node $S fee        $C --vault "$(vault POLYMARKET)" --bps 300
node $S multiplier $C --vault "$(vault NEURALINK)" --value 2 --in-seconds 120 --wait
node $S multiplier $C --vault "$(vault NEURALINK)" --value 1 --in-seconds 5 --note "restore mirror"
node $S hook-on    $C --vault "$(vault FIGUREAI)"
node $S hook-off   $C --vault "$(vault FIGUREAI)"
node $S freeze     $C --vault "$(vault ANTHROPIC)"
node $S thaw       $C --vault "$(vault ANTHROPIC)"
node $S default-state $C --vault "$(vault OPENAI)" --state frozen
node $S default-state $C --vault "$(vault OPENAI)" --state initialized
node scripts/fixtures/diff.ts $C --check || echo "DIFF check reports a mismatch (see fixtures/DIFF.md)"
echo "fixtures and scenarios done; start the API (CLUSTER=devnet) and run services/valuation/verify/*"
