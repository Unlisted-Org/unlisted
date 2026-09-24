#!/usr/bin/env bash
# Run ONLY in a window agreed with the spec owner (B's e2e not running). Mint-level scenarios on the
# canonical basket's fixture mints, and spec 03 acceptance checks 1-3 against the canonical basket.
# Every mint-level change is reversed and the mirror state is verified on chain right after.
#
#   IDL_PATH=<A's basket.json> BASKET_SHARE_MINT=HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj scripts/window.sh
# (the valuation API must be running with CLUSTER=devnet and the same IDL_PATH / BASKET_SHARE_MINT)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
: "${IDL_PATH:?}" "${BASKET_SHARE_MINT:?}"
export CLUSTER=devnet RPC_SPACING_MS="${RPC_SPACING_MS:-600}"
C="--cluster devnet"
vault() { node -e "
const {PublicKey}=require('./services/valuation/node_modules/@solana/web3.js');const r=require('./fixtures/registry.json');
const [b]=PublicKey.findProgramAddressSync([Buffer.from('basket'),new PublicKey('$BASKET_SHARE_MINT').toBuffer()],new PublicKey(require('$IDL_PATH').address));
const m=new PublicKey(r.legs.find(l=>l.symbol==='$1').mint);
console.log(PublicKey.findProgramAddressSync([b.toBuffer(),new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb').toBuffer(),m.toBuffer()],new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58())"; }
S=scripts/scenarios/issuer.ts
V=services/valuation/verify

# Acceptance 1 (raw numbers vs RPC) before anything moves.
(cd services/valuation && node verify/basket-vs-rpc.ts)
# Shares for the ops key (in-kind deposit), then acceptance 2 in kind.
node scripts/basket/deposit-in-kind.ts $C --idl "$IDL_PATH" --share-mint "$BASKET_SHARE_MINT" --shares 20000000
(cd services/valuation && node verify/redeem-payout.ts --shares 5000000 --holder ~/.config/solana/stocklana/ops.json)
# (a) pause/resume on the canonical KALSHI vault, inside acceptance 2 (claim created, then settled after resume).
(cd services/valuation && node verify/redeem-payout.ts --shares 5000000 --pause KALSHI --holder ~/.config/solana/stocklana/ops.json)
node scripts/scenarios/verify-restored.ts $C --after "pause/resume KALSHI"
# (b) hook on/off on FIGUREAI (target: canonical vault).
node $S hook-on  $C --vault "$(vault FIGUREAI)" --note "window: canonical basket vault"
node $S hook-off $C --vault "$(vault FIGUREAI)" --note "window: canonical basket vault"
node scripts/scenarios/verify-restored.ts $C --after "hook on/off FIGUREAI"
# (c) default state frozen -> initialized on OPENAI.
node $S default-state $C --vault "$(vault OPENAI)" --state frozen --note "window"
node $S default-state $C --vault "$(vault OPENAI)" --state initialized --note "window"
node scripts/scenarios/verify-restored.ts $C --after "default state OPENAI"
# (d) multiplier change on NEURALINK (acceptance 3); the check restores 1 itself.
(cd services/valuation && node verify/multiplier-display.ts --symbol NEURALINK --value 2 --in-seconds 150)
until node scripts/scenarios/verify-restored.ts $C --after "multiplier NEURALINK 1 -> 2 -> 1"; do sleep 15; done
# Acceptance 1 again after everything.
(cd services/valuation && node verify/basket-vs-rpc.ts)
echo "window complete"
