// Shared driver for the ported model tests: replay every scenario of a model test against the real program.
import assert from "node:assert/strict";
import { Replayer, Scenario, loadVector } from "../replay.ts";
import type { Unavail } from "../fixtures.ts";

export const MODES: Unavail[] = ["pause", "hook", "freeze"];

export interface Hooks {
  onOp?: (s: Scenario, op: any) => void;
  onBefore?: (s: Scenario, op: any) => void;
}

/**
 * Replays the model test `test` (every recorded scenario) on the real program. Unavailability is produced by a
 * real issuer action, cycling pause / hook / freeze by scenario (or by pair for paused/control pairs).
 * `modes` forces a list of modes: each scenario is then replayed once per mode.
 */
export function replay(test: string, hooks: Hooks = {}, opts: { pairs?: boolean; modes?: Unavail[] } = {}) {
  const v = loadVector(test);
  assert.equal(v.model_passed, true, `model test ${test} must pass in Python first`);
  const r = new Replayer();
  const out: Scenario[][] = [];
  v.scenarios.forEach((scn: any, i: number) => {
    const modes = opts.modes ?? [MODES[(opts.pairs ? Math.floor(i / 2) : i) % 3]];
    out.push(modes.map((m) => r.run(test, JSON.parse(JSON.stringify(scn)), i, m, hooks)));
  });
  const st = r.stats;
  const total = v.scenarios.reduce((a: number, s: any) => a + s.ops.length, 0) * (opts.modes?.length ?? 1);
  assert.equal(st.ops, total, "every recorded op replayed");
  assert.equal(st.compared, total, "every op's state compared to the unit");
  console.log(`  ${test}: ${st.scenarios} scenarios, ${st.ops} model ops, ${st.txs} transactions, ${st.refusedMatched} refusals matched`);
  return { scenarios: out, stats: st };
}

export const big = (x: any) => BigInt(x.toString());

/**
 * Four model tests bootstrap with a share count other than INITIAL_SHARES, which the program (spec 02) cannot do.
 * Check the original passes in the model and really needs the variant, then the caller replays the variant.
 */
export function variantOf(test: string): string {
  const v = loadVector(test);
  assert.equal(v.model_passed, true);
  const boot = v.scenarios[0].ops.find((o: any) => o.op === "bootstrap");
  assert.notEqual(boot.args.initial_shares, "1000000000", `${test} does not need a variant`);
  return `${test}__initial_shares_1e9`;
}
export const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
/** a/b >= c/d for non-negative rationals (denominators > 0). */
export const fracGe = (a: bigint, b: bigint, c: bigint, d: bigint) => a * d >= c * b;
export function perShare(s: Scenario, i: number): [bigint, bigint] {
  return [s.owned(i), s.denom(i)];
}
