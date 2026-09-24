// Port of spec/model/test_basket_model.py :: RoundingFavoursVault (4 tests), against the real program.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, fracGe, perShare, big, variantOf } from "./common.ts";
import { tokenAmount } from "../fixtures.ts";

const C = "RoundingFavoursVault";

test(`${C}.test_entitlements_never_exceed_balance`, () => {
  let checks = 0;
  replay(`${C}.test_entitlements_never_exceed_balance`, {
    onOp: (s, op) => {
      // The model test checks after every op, right after observing every leg: so do we, from chain state only.
      if (op.op !== "observe" || op.args.legs.length !== s.n) return;
      const legs = s.c.legs();
      const supply = s.c.supply();
      for (let i = 0; i < s.n; i++) {
        const bal = s.c.balance(i);
        const pending = (legs[i].pendingNorm * legs[i].lossIndex) / 10n ** 18n;
        const owned = bal - pending;
        const denom = supply + legs[i].claimUnits;
        let owed = pending;
        if (denom > 0n) {
          for (const o of s.owners.values()) owed += (s.c.shares(o.publicKey) * owned) / denom;
          for (const u of s.openClaimUnits(i)) owed += (u * owned) / denom;
        }
        assert.ok(owed <= bal, `${s.label} leg ${i}: owed ${owed} > balance ${bal}`);
        checks++;
      }
    },
  });
  assert.ok(checks > 10_000, `entitlement checks run: ${checks}`);
});

function dilutionTest(name: string, opName: string) {
  test(`${C}.${name}`, () => {
    let before: [bigint, bigint][] = [];
    let checked = 0;
    replay(`${C}.${name}`, {
      onBefore: (s, op) => { if (op.op === opName && (opName !== "mint_in_kind" || op.args.owner === "new")) before = Array.from({ length: s.n }, (_, i) => perShare(s, i)); },
      onOp: (s, op) => {
        if (op.op !== opName || (opName === "mint_in_kind" && op.args.owner !== "new")) return;
        for (let i = 0; i < s.n; i++) {
          const [a, b] = perShare(s, i);
          if (b === 0n) continue;
          assert.ok(fracGe(a, b, before[i][0], before[i][1]), `${s.label} leg ${i}: per-share fell`);
          checked++;
        }
      },
    });
    assert.ok(checked >= 300 * 7 - 50, `per-share checks: ${checked}`);
  });
}
dilutionTest("test_mint_never_dilutes_existing_holders", "mint_in_kind");
dilutionTest("test_redeem_never_dilutes_remaining_holders", "redeem_in_kind");

test(`${C}.test_redeem_pays_floor (INITIAL_SHARES variant)`, () => {
  const { scenarios } = replay(variantOf(`${C}.test_redeem_pays_floor`), {}, { modes: ["pause"] });
  const s = scenarios[0][0];
  const redeem = s.scn.ops.find((o: any) => o.op === "redeem_in_kind");
  assert.equal(redeem.chain.paid["0"], 3n); // floor(1 * 3_333_333_334 / 1e9), not 4
  assert.equal(tokenAmount(s.env, s.c.vaults[0]), 3_333_333_331n);
});
