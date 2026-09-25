// Port of Shortfall (3 tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, perShare, absDiff, big, variantOf } from "./common.ts";

const C = "Shortfall";

test(`${C}.test_seizure_is_shared_pro_rata_and_observed`, () => {
  let before = new Map<string, bigint>(), bal = 0n, seized = 0n, leg = -1, checked = 0;
  replay(`${C}.test_seizure_is_shared_pro_rata_and_observed`, {
    onBefore: (s, op) => {
      if (op.op !== "external_seize") return;
      leg = op.args.leg;
      bal = s.c.balance(leg);
      seized = big(op.args.amount);
      before = new Map([...s.owners.keys()].map((o) => [o, s.holderClaim(o, leg)]));
    },
    onOp: (s, op) => {
      if (op.op !== "observe" || leg < 0) return;
      assert.equal(s.c.balance(leg), bal - seized, "the permanent delegate burned from the vault");
      for (const [o, b] of before) {
        const after = s.holderClaim(o, leg);
        // |after - before * (bal - seized) / bal| <= 1, cross-multiplied
        assert.ok(absDiff(after * bal, b * (bal - seized)) <= bal, `${s.label} holder ${o}`);
        checked++;
      }
      leg = -1;
    },
  });
  assert.ok(checked >= 200 * 4, `holders checked ${checked}`);
});

test(`${C}.test_later_depositors_do_not_make_holders_whole`, () => {
  let leg = -1, afterSeizure: [bigint, bigint] = [0n, 1n], checked = 0;
  replay(`${C}.test_later_depositors_do_not_make_holders_whole`, {
    onBefore: (s, op) => { if (op.op === "external_seize") leg = op.args.leg; },
    onOp: (s, op) => {
      if (op.op === "observe" && leg >= 0) afterSeizure = perShare(s, leg);
      if (op.op === "mint_in_kind" && op.args.owner === "late") {
        const [a, b] = perShare(s, leg);
        const [a0, b0] = afterSeizure;
        // per_share(after) - per_share(seized) <= 2 * per_share(seized) / denom(after)
        assert.ok((a * b0 - a0 * b) * b <= 2n * a0 * b, `${s.label}: holders topped up`);
        const gross = big(op.args.gross[leg]);
        const net = gross - (gross * 100n + 9_999n) / 10_000n;
        const late = s.holderClaim("late", leg);
        assert.ok(late <= net && late >= (net * 99n) / 100n, `${s.label}: late claim ${late} vs net ${net}`);
        checked++;
        leg = -1;
      }
    },
  });
  assert.equal(checked, 200);
});

test(`${C}.test_open_ticket_bears_shortfall_pro_rata (INITIAL_SHARES variant)`, () => {
  for (const mode of ["pause"] as const) {
    const { scenarios } = replay(variantOf(`${C}.test_open_ticket_bears_shortfall_pro_rata`), {}, { modes: [mode] });
    const s = scenarios[0][0];
    const fin = s.scn.ops.find((o: any) => o.op === "finalize_ticket");
    assert.equal(fin.chain, 10n ** 9n); // the ticket's shares are unchanged by the seizure: as many as the seed's
    assert.equal(s.holderClaim("seed", 0), 5n * 10n ** 11n);
    assert.equal(s.holderClaim("u", 0), 5n * 10n ** 11n);
    assert.equal(s.holderClaim("u", 1), 10n ** 12n);
  }
});
