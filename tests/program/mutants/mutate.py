"""Deliberately broken programs: each mutant must make the suite fail ("would the check fail if broken?").
Usage: python3 mutate.py <name>   (patches programs/basket/src/lib.rs in place; run.sh restores it)"""
import sys, pathlib
LIB = pathlib.Path(__file__).resolve().parents[3] / "programs/basket/src/lib.rs"
MUTANTS = {
    # 1. Rounding in the redeemer's favour: pay ceil instead of floor.
    "redeem-rounds-up": ("    to_u64(mul_div(units as u128, owned(l, bal)?, denom)?)\n",
                         "    to_u64((units as u128 * owned(l, bal)? + denom - 1) / denom)\n"),
    # 2. An open ticket escapes a seizure: finalize credits the stored norm without the loss index.
    "ticket-escapes-shortfall": ("            deltas[i] = to_u64(mul_div(norms[i], l.loss_index, INDEX_ONE)?)?;\n",
                                 "            deltas[i] = to_u64(norms[i])?;\n"),
    # 3. No partial redemption: an unavailable leg is paid (attempted) instead of becoming a claim.
    "pay-paused-leg": ("            if why.is_none() && in_kind {\n", "            if in_kind {\n"),
    # 4. Loss index never moves: a shortfall is not shared with open tickets.
    "no-loss-index": ("        leg.loss_index = mul_div(leg.loss_index, bal as u128, leg.accounted as u128)?;\n",
                      "        leg.loss_index = leg.loss_index;\n"),
}
a, b = MUTANTS[sys.argv[1]]
src = LIB.read_text()
assert src.count(a) == 1, sys.argv[1]
LIB.write_text(src.replace(a, b))
print("mutated", sys.argv[1])
