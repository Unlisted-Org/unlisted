// /v1/quote/redeem's maths vs the reference model, to the unit, on shared vectors (spec 00: "C's
// /v1/quote/redeem must match the model to the unit on shared test vectors").
// Vectors: test/gen_redeem_vectors.py (regenerated here if missing; deterministic seeds).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { quoteRedeem } from "../src/lib/sharemath.ts";
import type { LegState } from "../src/lib/sharemath.ts";

const path = join(import.meta.dirname, "redeem_vectors.json");
if (!existsSync(path)) writeFileSync(path, execFileSync("python3", [join(import.meta.dirname, "gen_redeem_vectors.py")], { maxBuffer: 64 << 20 }));
const { vectors } = JSON.parse(readFileSync(path, "utf8"));

const legsOf = (st: any): LegState[] => st.legs.map((l: any) => ({
  balance: BigInt(l.balance), accounted: BigInt(l.accounted), claim_units: BigInt(l.claim_units), pending_norm: BigInt(l.pending_norm),
  loss_index: BigInt(l.loss_index), available: l.available, unavailable_reason: l.available ? null : "paused", retired: l.retired,
  fee_bps: l.fee_bps, maximum_fee: 2n ** 64n - 1n,
}));

test(`quoteRedeem equals the reference model on ${vectors.length} vectors (gross, fee, net, claims)`, () => {
  let pays = 0, sales = 0, claims = 0, observed = 0;
  for (const v of vectors) {
    const legs = legsOf(v.state);
    if (legs.some((l) => l.balance !== l.accounted)) observed++;
    const q = quoteRedeem(legs, BigInt(v.state.supply), BigInt(v.shares), v.mode);
    const where = `seed ${v.seed} step ${v.step} ${v.mode}`;
    assert.equal(q.length, v.model.legs.length, where);
    for (const m of v.model.legs) {
      const x: any = q.find((y) => y.index === m.index);
      assert.ok(x, `${where}: leg ${m.index} missing`);
      if (m.action === "claim") { claims++; assert.equal(x.action, "claim", where); assert.equal(x.units.toString(), m.units, where); continue; }
      const gross = x.action === "pay" ? x.gross_raw : x.gross_raw_if_settled_now;
      assert.equal(gross.toString(), m.gross, `${where}: leg ${m.index} gross`);
      assert.equal((gross - x.fee_raw).toString(), m.net, `${where}: leg ${m.index} net`);
      if (x.action === "pay") pays++; else sales++;
    }
  }
  assert.ok(pays > 1000 && sales > 1000 && claims > 1000 && observed > 100, `coverage pays ${pays} sales ${sales} claims ${claims} observe ${observed}`);
});

test("check discriminates: skipping observe() before quoting breaks vectors with an unobserved shortfall", async () => {
  const sm = await import("../src/lib/sharemath.ts");
  let broke = 0;
  for (const v of vectors) {
    const legs = legsOf(v.state);
    if (!legs.some((l) => l.balance < l.accounted && l.pending_norm > 0n)) continue;
    // Wrong on purpose: owned with the stale loss index.
    const S = BigInt(v.state.supply), s = BigInt(v.shares);
    for (const m of v.model.legs) {
      if (m.action === "claim") continue;
      const l = legs[m.index];
      const wrong = (s * (l.balance - sm.pendingActual(l))) / (S + l.claim_units);
      if (wrong.toString() !== m.gross) broke++;
    }
  }
  assert.ok(broke > 0, "a quote that skips observe() must disagree with the model somewhere");
});
