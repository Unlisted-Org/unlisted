import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveMultiplier, feeSchedule, transferFee } from "../src/lib/token2022.ts";

const mint = (cfg: any) => ({ extensions: [{ extension: "scaledUiAmountConfig", state: cfg }] });

test("effective multiplier: newMultiplier once its timestamp has passed, else the stored field", () => {
  // Mainnet OPENAI today: stored 1, new 1.4861347 at 1784305800 (passed). Reading `multiplier` alone is the bug.
  const m = mint({ multiplier: "1", newMultiplier: "1.4861347", newMultiplierEffectiveTimestamp: 1784305800 });
  assert.equal(effectiveMultiplier(m, 1784305799).effective, "1");
  assert.deepEqual(effectiveMultiplier(m, 1784305799).pending?.multiplier, "1.4861347");
  assert.equal(effectiveMultiplier(m, 1784305800).effective, "1.4861347");
  assert.equal(effectiveMultiplier(m, 1784305800).pending, null);
  assert.equal(effectiveMultiplier({ extensions: [] }, 0).effective, "1");
});

test("fee schedule: newer applies from its epoch; pending reported before it", () => {
  const m = { extensions: [{ extension: "transferFeeConfig", state: {
    olderTransferFee: { epoch: 1039, maximumFee: "18446744073709551615", transferFeeBasisPoints: 100 },
    newerTransferFee: { epoch: 1043, maximumFee: "18446744073709551615", transferFeeBasisPoints: 300 } } }] };
  assert.equal(feeSchedule(m, 1042)!.now_bps, 100);
  assert.deepEqual(feeSchedule(m, 1042)!.pending, { bps: 300, maximum_fee: "18446744073709551615", effective_epoch: 1043 });
  assert.equal(feeSchedule(m, 1043)!.now_bps, 300);
  assert.equal(feeSchedule(m, 1043)!.pending, null);
});

test("transfer fee rounds up and caps at maximum_fee", () => {
  assert.equal(transferFee(10_000_000n, 100), 100_000n);
  assert.equal(transferFee(1n, 100), 1n);
  assert.equal(transferFee(33_334n, 300), 1001n);
  assert.equal(transferFee(10n ** 12n, 300, 5n), 5n);
});
