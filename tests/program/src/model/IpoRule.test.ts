// Port of IpoRule (3 tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, fracGe, perShare, big } from "./common.ts";

const C = "IpoRule";

test(`${C}.test_conversion_preserves_every_holders_fraction`, () => {
  let shares = new Map<string, bigint>(), supply = 0n, before: [number, [bigint, bigint]][] = [], checked = 0;
  replay(`${C}.test_conversion_preserves_every_holders_fraction`, {
    onBefore: (s, op) => {
      if (op.op === "convert_listed_leg") {
        supply = s.c.supply();
        shares = new Map([...s.owners].map(([o, k]) => [o, s.c.shares(k.publicKey)]));
      }
      if (op.op === "reinvest_reserve") before = s.c.activeLegs().map((i) => [i, perShare(s, i)]);
    },
    onOp: (s, op) => {
      if (op.op === "convert_listed_leg") {
        const k = op.args.leg;
        assert.equal(s.c.legs()[k].status, "Retired");
        assert.equal(s.owned(k), 0n);
        assert.equal(s.c.supply(), supply);
        for (const [o, n] of shares) assert.equal(s.c.shares(s.owner(o).publicKey), n);
      }
      if (op.op === "reinvest_reserve") {
        for (const [i, [a0, b0]] of before) {
          const [a, b] = perShare(s, i);
          assert.ok(fracGe(a, b, a0, b0), `${s.label} leg ${i} per-share fell on reinvest`);
          checked++;
        }
        assert.equal(s.c.state().reinvest_mask, 0);
      }
    },
  });
  assert.equal(checked, 100 * 6);
});

test(`${C}.test_conversion_waits_for_open_claims`, () => {
  const { scenarios } = replay(`${C}.test_conversion_waits_for_open_claims`, {}, { modes: ["pause", "hook", "freeze"] });
  for (const [s] of scenarios) {
    const conv = s.scn.ops.filter((o: any) => o.op === "convert_listed_leg");
    assert.equal(conv[0].refused, "OutstandingClaims");
    assert.ok(conv[1].chain > 0n);
  }
});

test(`${C}.test_redeem_during_conversion_gets_pro_rata_usdc`, () => {
  const { scenarios } = replay(`${C}.test_redeem_during_conversion_gets_pro_rata_usdc`, {}, { modes: ["pause"] });
  const r = scenarios[0][0].scn.ops.find((o: any) => o.op === "redeem_in_kind").chain;
  assert.equal(r.paid.usdc, (2n * 10n ** 12n * 2n) / 2n);
  assert.equal(r.paid["0"], undefined);
});
