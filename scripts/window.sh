#!/usr/bin/env bash
# Run ONLY in a window agreed with the spec owner (B's e2e not running). Mint-level scenarios on the
# canonical basket's fixture mints, and spec 03 acceptance checks against the canonical basket.
# Reversals are state-driven: after each scenario, the mint is read on chain and the reversal is
# re-issued until verify-restored.ts passes (a script can die on a 429 after its transaction landed).
#
#   IDL_PATH=<A's basket.json> BASKET_SHARE_MINT=HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj scripts/window.sh
# (the valuation API must be running with CLUSTER=devnet and the same IDL_PATH / BASKET_SHARE_MINT)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
: "${IDL_PATH:?}" "${BASKET_SHARE_MINT:?}"
export CLUSTER=devnet RPC_SPACING_MS="${RPC_SPACING_MS:-1000}"
C="--cluster devnet"
S=scripts/scenarios/issuer.ts
vault() { node -e "
const {PublicKey}=require('./services/valuation/node_modules/@solana/web3.js');const r=require('./fixtures/registry.json');
const [b]=PublicKey.findProgramAddressSync([Buffer.from('basket'),new PublicKey('$BASKET_SHARE_MINT').toBuffer()],new PublicKey(require('$IDL_PATH').address));
const m=new PublicKey(r.legs.find(l=>l.symbol==='$1').mint);
console.log(PublicKey.findProgramAddressSync([b.toBuffer(),new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb').toBuffer(),m.toBuffer()],new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58())"; }
mintstate() { node -e "
import('./services/valuation/src/lib/rpc.ts').then(async m=>{const r=require('./fixtures/registry.json');const i=(await new m.Rpc('devnet').account(r.legs.find(l=>l.symbol==='$1').mint)).value.data.parsed.info;
const x=Object.fromEntries(i.extensions.map(e=>[e.extension,e.state]));const s=x.scaledUiAmountConfig;const now=Date.now()/1000;
console.log(JSON.stringify({paused:x.pausableConfig.paused,hook:x.transferHook.programId,state:x.defaultAccountState.accountState,eff:(now>=s.newMultiplierEffectiveTimestamp?s.newMultiplier:s.multiplier),pending:now<s.newMultiplierEffectiveTimestamp&&s.newMultiplier!=s.multiplier}))})"; }
# restore SYMBOL: re-issue the reversal until the leg is back in its mirror state, then record the proof.
restore() {
  local sym=$1 v; v=$(vault "$sym")
  for i in $(seq 1 60); do
    local s; s=$(mintstate "$sym" 2>/dev/null) || { sleep 20; continue; }
    echo "  $sym state $s"
    case "$s" in
      *'"paused":true'*) node $S resume $C --vault "$v" --note "window: reversal" ;;
      *'"hook":"'*) node $S hook-off $C --vault "$v" --note "window: reversal" ;;
      *'"state":"frozen"'*) node $S default-state $C --vault "$v" --state initialized --note "window: reversal" ;;
      *'"pending":true'*|*'"eff":"2"'*) node $S multiplier $C --vault "$v" --value 1 --in-seconds 5 --note "window: reversal" ;;
      *) node scripts/scenarios/verify-restored.ts $C --after "$2" && return 0 ;;
    esac
    sleep 15
  done
  echo "RESTORE OF $sym NOT CONFIRMED"; return 1
}

(cd services/valuation && node verify/basket-vs-rpc.ts)
node scripts/basket/deposit-in-kind.ts $C --idl "$IDL_PATH" --share-mint "$BASKET_SHARE_MINT" --shares 20000000
(cd services/valuation && node verify/redeem-payout.ts --shares 5000000 --holder ~/.config/solana/stocklana/ops.json)
# (a) pause/resume KALSHI inside acceptance 2 (claim created, settled after resume).
(cd services/valuation && node verify/redeem-payout.ts --shares 5000000 --pause KALSHI --holder ~/.config/solana/stocklana/ops.json)
restore KALSHI "pause/resume KALSHI" || exit 1
# (b) hook on/off FIGUREAI.
node $S hook-on $C --vault "$(vault FIGUREAI)" --note "window: canonical basket vault"
node $S hook-off $C --vault "$(vault FIGUREAI)" --note "window: canonical basket vault"
restore FIGUREAI "hook on/off FIGUREAI" || exit 1
# (c) default state frozen -> initialized on OPENAI.
node $S default-state $C --vault "$(vault OPENAI)" --state frozen --note "window: canonical basket vault"
node $S default-state $C --vault "$(vault OPENAI)" --state initialized --note "window: canonical basket vault"
restore OPENAI "default state OPENAI" || exit 1
# (d) multiplier NEURALINK 1 -> 2 (acceptance 3; the check itself schedules the restore to 1).
(cd services/valuation && node verify/multiplier-display.ts --symbol NEURALINK --value 2 --in-seconds 150)
sleep 10
restore NEURALINK "multiplier NEURALINK 1 -> 2 -> 1" || exit 1
(cd services/valuation && node verify/basket-vs-rpc.ts)
echo "window complete"
