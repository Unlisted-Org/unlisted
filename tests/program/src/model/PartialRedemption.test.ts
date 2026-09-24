// Port of PartialRedemption (5 tests): the headline. Paused/control pairs run as two real baskets and their
// on-chain payouts are compared with each other, not only with the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, absDiff, big, MODES } from "./common.ts";

const C = "PartialRedemption";

test(`${C}.test_available_legs_pay_immediately_and_claim_pays_after_resume`, () => {
  const { scenarios } = replay(`${C}.test_available_legs_pay_immediately_and_claim_pays_after_resume`, {}, { pairs: true });
  let pairs = 0;
  for (let k = 0; k < scenarios.length; k += 2) {
    const paused = scenarios[k][0], control = scenarios[k + 1][0];
    const rp = paused.scn.ops.find((o: any) => o.op === "redeem_in_kind").chain;
    const rc = control.scn.ops.find((o: any) => o.op === "redeem_in_kind").chain;
    assert.equal(rp.claims.length, 1, `${paused.label}: one claim`);
    const leg = rp.claims[0];
    for (let i = 0; i < paused.n; i++) {
      if (i === leg) assert.equal(rp.paid[String(i)], undefined, "the paused leg is not paid now");
      else assert.equal(rp.paid[String(i)], rc.paid[String(i)], `${paused.label} leg ${i}: paid now == unpaused control, to the unit`);
    }
    const settled = paused.scn.ops.find((o: any) => o.op === "settle_claim").chain;
    assert.ok(absDiff(settled, rc.paid[String(leg)]) <= 1n, `${paused.label}: claim ${settled} vs control ${rc.paid[String(leg)]}`);
    pairs++;
  }
  assert.equal(pairs, 200);
});

test(`${C}.test_other_holders_unaffected_while_claim_open`, () => {
  let before = new Map<string, bigint[]>(), redeemer = "", checked = 0;
  replay(`${C}.test_other_holders_unaffected_while_claim_open`, {
    onBefore: (s, op) => {
      if (op.op !== "redeem_in_kind") return;
      redeemer = op.args.owner;
      before = new Map([...s.owners.keys()].filter((h) => h !== redeemer).map((h) => [h, Array.from({ length: s.n }, (_, i) => s.holderClaim(h, i))]));
    },
    onOp: (s, op) => {
      if (op.op !== "redeem_in_kind") return;
      for (const [h, b] of before) for (let i = 0; i < s.n; i++) {
        assert.ok(s.holderClaim(h, i) >= b[i], `${s.label} ${h} leg ${i}`);
        checked++;
      }
    },
  }, { pairs: true });
  assert.ok(checked > 400 * 7);
});

test(`${C}.test_claim_shares_a_later_seizure_pro_rata`, () => {
  for (const mode of MODES) {
    const { scenarios } = replay(`${C}.test_claim_shares_a_later_seizure_pro_rata`, {}, { modes: [mode] });
    const s = scenarios[0][0];
    assert.equal(s.scn.ops.find((o: any) => o.op === "settle_claim").chain, 5n * 10n ** 11n, `${mode}: claimant takes half the loss`);
    assert.equal(s.holderClaim("seed", 3), 5n * 10n ** 11n);
  }
});

test(`${C}.test_usdc_mode_claims_settle_to_the_in_kind_amounts`, () => {
  const { scenarios } = replay(`${C}.test_usdc_mode_claims_settle_to_the_in_kind_amounts`, {}, { pairs: true });
  let n = 0;
  for (let k = 0; k < scenarios.length; k += 2) {
    const a = scenarios[k][0], control = scenarios[k + 1][0];
    const rc = control.scn.ops.find((o: any) => o.op === "redeem_in_kind").chain;
    for (const op of a.scn.ops.filter((o: any) => o.op === "settle_claim")) {
      assert.ok(absDiff(op.chain, rc.paid[String(op.args.leg)]) <= 1n, `${a.label} leg ${op.args.leg}`);
      n++;
    }
  }
  assert.equal(n, 200 * 7);
});

test(`${C}.test_multiple_paused_legs_and_deposit_refused`, () => {
  for (const mode of MODES) {
    const { scenarios } = replay(`${C}.test_multiple_paused_legs_and_deposit_refused`, {}, { modes: [mode] });
    const s = scenarios[0][0];
    const r = s.scn.ops.find((o: any) => o.op === "redeem_in_kind").chain;
    assert.deepEqual([...r.claims].sort(), [1, 4]);
    assert.equal(Object.keys(r.paid).filter((k) => k !== "usdc").length, s.n - 2);
    const refused = s.scn.ops.filter((o: any) => o.op === "mint_in_kind" && o.refused);
    assert.equal(refused.length, 1, `${mode}: deposit refused with LegUnavailable on chain`);
  }
});
