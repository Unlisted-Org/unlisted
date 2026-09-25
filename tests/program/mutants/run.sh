#!/usr/bin/env bash
# Build each mutant, run the tests that should catch it, and require that they FAIL. Restores the program.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$ROOT/tests/program"
OUT="$T/out/mutants.log"
: > "$OUT"
trap 'git -C "$ROOT" checkout -- programs/basket/src/lib.rs' EXIT
tests_for() {
  case "$1" in
    redeem-rounds-up) echo "src/model/RoundingFavoursVault.test.ts" ;;
    ticket-escapes-shortfall) echo "src/model/Shortfall.test.ts" ;;
    pay-paused-leg) echo "src/partial.test.ts src/model/PartialRedemption.test.ts" ;;
    no-loss-index) echo "src/model/Shortfall.test.ts" ;;
  esac
}
for m in redeem-rounds-up ticket-escapes-shortfall pay-paused-leg no-loss-index; do
  git -C "$ROOT" checkout -- programs/basket/src/lib.rs
  python3 "$T/mutants/mutate.py" "$m" >> "$OUT"
  cargo build-sbf --manifest-path "$ROOT/programs/basket/Cargo.toml" > /dev/null 2>&1 || { echo "$m: BUILD FAILED" >> "$OUT"; continue; }
  cp "$ROOT/target/deploy/basket.so" "${TMPDIR:-/tmp}/basket-mutant-$m.so"
  (cd "$T" && BASKET_SO="${TMPDIR:-/tmp}/basket-mutant-$m.so" node --import tsx --test --test-concurrency=4 $(tests_for $m) 2>&1) \
    | grep -E "^(✔|✖)|^ℹ (pass|fail)|state differs|paid: model|differ|Error:" | head -20 | sed "s/^/  [$m] /" >> "$OUT"
  rm -f "${TMPDIR:-/tmp}/basket-mutant-$m.so"
done
git -C "$ROOT" checkout -- programs/basket/src/lib.rs
cargo build-sbf --manifest-path "$ROOT/programs/basket/Cargo.toml" > /dev/null 2>&1
shasum -a 256 "$ROOT/target/deploy/basket.so" >> "$OUT"
