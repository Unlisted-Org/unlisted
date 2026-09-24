// Replays vectors produced by the reference model (spec/model/basket_model.py) through the
// SDK's pure share-maths functions. Every figure must match to the unit.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LegState, Refused, finalizeShares, mintInKind, observe, redeemInKind, settleClaim, ticketNorm, netDeltasForShares, sharesForDeltas,
} from "../src/math.js";
import { transferFee } from "../src/token2022.js";

type SnapLeg = { balance: string; accounted: string; claimUnits: string; pendingNorm: string; lossIndex: string; available: boolean; feeBps: number };
type Snap = { supply: string; legs: SnapLeg[] };

const data = JSON.parse(readFileSync(fileURLToPath(new URL("./vectors/vectors.json", import.meta.url)), "utf8"));
const vectors: any[] = data.vectors;

const leg = (l: SnapLeg): LegState => ({
  balance: BigInt(l.balance), accounted: BigInt(l.accounted), claimUnits: BigInt(l.claimUnits),
  pendingNorm: BigInt(l.pendingNorm), lossIndex: BigInt(l.lossIndex), available: l.available,
});
const legs = (s: Snap) => s.legs.map(leg);
const fees = (s: Snap) => s.legs.map((l) => ({ bps: l.feeBps }));

const byOp = (op: string) => vectors.filter((v) => v.op === op);

describe("shared vectors from spec/model", () => {
  it("has enough of every operation to mean something", () => {
    expect(byOp("mint_in_kind").filter((v) => !v.refused).length).toBeGreaterThan(50);
    expect(byOp("redeem_in_kind").filter((v) => v.legs.some((l: any) => l.action === "claim")).length).toBeGreaterThan(50);
    expect(byOp("settle_claim").filter((v) => !v.refused).length).toBeGreaterThan(50);
    expect(byOp("ticket").length).toBeGreaterThan(50);
    expect(byOp("observe").filter((v) => v.post.lossIndex !== v.pre.legs[v.leg].lossIndex).length).toBeGreaterThan(10);
  });

  it("observe: loss index and accounted balance", () => {
    for (const v of byOp("observe")) {
      const r = observe(leg(v.pre.legs[v.leg]));
      expect(r.leg.lossIndex.toString()).toBe(v.post.lossIndex);
      expect(r.leg.accounted.toString()).toBe(v.post.accounted);
    }
  });

  it("mint_in_kind: shares minted, and refusals", () => {
    for (const v of byOp("mint_in_kind")) {
      const run = () => mintInKind(legs(v.pre), BigInt(v.pre.supply), v.gross.map(BigInt), fees(v.pre));
      if (v.refused) {
        expect(run).toThrowError(new Refused(v.refused));
      } else {
        expect(run().shares.toString()).toBe(v.shares);
      }
    }
  });

  it("redeem_in_kind: every leg's gross, fee and net, and every claim", () => {
    let claims = 0;
    for (const v of byOp("redeem_in_kind")) {
      const out = redeemInKind(legs(v.pre), BigInt(v.pre.supply), BigInt(v.shares), fees(v.pre));
      out.forEach((o, i) => {
        const want = v.legs[i];
        expect(o.action).toBe(want.action);
        if (o.action === "pay") {
          expect(o.gross.toString()).toBe(want.gross);
          expect(o.fee.toString()).toBe(want.fee);
          expect(o.net.toString()).toBe(want.net);
        } else if (o.action === "claim") {
          claims++;
          expect(o.units.toString()).toBe(want.units);
        }
      });
    }
    expect(claims).toBeGreaterThan(50);
  });

  it("settle_claim: payout after resume, refusal while unavailable", () => {
    for (const v of byOp("settle_claim")) {
      const l = v.pre.legs[v.leg];
      const run = () => settleClaim(leg(l), BigInt(v.pre.supply), BigInt(v.units), { bps: l.feeBps });
      if (v.refused) expect(run).toThrowError(new Refused(v.refused));
      else {
        const r = run();
        expect(r.gross.toString()).toBe(v.gross);
        expect(r.net.toString()).toBe(v.net);
      }
    }
  });

  it("deposit ticket: per-leg credit and finalize shares (incl. shortfall during the ticket)", () => {
    for (const v of byOp("ticket")) {
      for (const land of v.lands) {
        const lp: SnapLeg = land.legPre;
        const obs = observe(leg(lp)).leg;
        const delta = BigInt(land.gross) - transferFee(BigInt(land.gross), { bps: lp.feeBps });
        expect(delta.toString()).toBe(land.delta);
        expect(ticketNorm(delta, obs.lossIndex).toString()).toBe(land.norm);
      }
      const pre = legs(v.preFinalize).map((l) => observe(l).leg);
      const r = finalizeShares(pre, BigInt(v.preFinalize.supply), v.norms.map(BigInt));
      expect(r.shares.toString()).toBe(v.shares);
    }
  });
});

describe("mutation sanity: the vectors catch a broken rounding", () => {
  it("rounding a redemption up would fail the vectors", () => {
    const v = byOp("redeem_in_kind").find((x) => x.legs.some((l: any) => l.action === "pay"));
    const i = v.legs.findIndex((l: any) => l.action === "pay");
    const l = observe(leg(v.pre.legs[i])).leg;
    const num = BigInt(v.shares) * (l.balance - (l.pendingNorm * l.lossIndex) / 10n ** 18n);
    const den = BigInt(v.pre.supply) + l.claimUnits;
    const ceil = (num + den - 1n) / den;
    // At least one vector must distinguish floor from ceil, or the suite above proves nothing about rounding.
    const distinguishing = byOp("redeem_in_kind").some((x) =>
      x.legs.some((lg: any, j: number) => {
        if (lg.action !== "pay") return false;
        const o = observe(leg(x.pre.legs[j])).leg;
        const n = BigInt(x.shares) * (o.balance - (o.pendingNorm * o.lossIndex) / 10n ** 18n);
        const d = BigInt(x.pre.supply) + o.claimUnits;
        return n % d !== 0n;
      }));
    expect(distinguishing).toBe(true);
    expect(ceil >= BigInt(v.legs[i].gross)).toBe(true);
  });
});

describe("deposit sizing", () => {
  it("netDeltasForShares mints at least the requested shares, and not one unit of a leg less", () => {
    for (const v of byOp("mint_in_kind").filter((x) => !x.refused).slice(0, 80)) {
      const ls = legs(v.pre).map((l) => ({ ...l, available: true }));
      const S = BigInt(v.pre.supply);
      const want = S / 7n + 12345n;
      const deltas = netDeltasForShares(ls, S, want);
      const got = sharesForDeltas(ls.map((l) => observe(l).leg), S, deltas);
      expect(got >= want).toBe(true);
      // one unit less on any leg must be able to drop below: sizing is tight
      const tight = deltas.some((_, i) => {
        const d2 = deltas.map((d, j) => (j === i ? d - 1n : d));
        return sharesForDeltas(ls.map((l) => observe(l).leg), S, d2) < want;
      });
      expect(tight).toBe(true);
    }
  });
});
