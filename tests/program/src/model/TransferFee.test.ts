// Port of TransferFee (2 tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, big } from "./common.ts";

const C = "TransferFee";

test(`${C}.test_mint_credits_measured_net_not_gross`, () => {
  let vaultAfterBootstrap = -1n;
  const { scenarios } = replay(`${C}.test_mint_credits_measured_net_not_gross`, {
    onOp: (s, op) => { if (op.op === "bootstrap") vaultAfterBootstrap = s.c.balance(0); },
  }, { modes: ["pause"] });
  assert.equal(vaultAfterBootstrap, 990_000_000n); // vault holds net of the 1% fee, measured
  const mint = scenarios[0][0].scn.ops.find((o: any) => o.op === "mint_in_kind");
  assert.equal(mint.chain, 1_000_000_000n);
});

test(`${C}.test_fee_change_mid_position_needs_no_stored_fee`, () => {
  let owed = -1n;
  const { scenarios } = replay(`${C}.test_fee_change_mid_position_needs_no_stored_fee`, {
    onBefore: (s, op) => { if (op.op === "redeem_in_kind") owed = s.holderClaim("u", 0); },
  }, { modes: ["pause"] });
  const redeem = scenarios[0][0].scn.ops.find((o: any) => o.op === "redeem_in_kind");
  const fee = (owed * 100n + 9_999n) / 10_000n; // the new 100 bps fee, charged by Token-2022 after two epochs
  assert.equal(redeem.chain.paid["0"], owed - fee);
});
