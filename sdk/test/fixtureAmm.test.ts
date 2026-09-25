import { describe, expect, it } from "vitest";
import { quoteFixtureSwap } from "../src/routers/fixtureAmm.js";

// Mirrors fixtures/amm/src/lib.rs swap(): received = in − fee_in; eff = received × (1e4 − lp)/1e4;
// out = R_out × eff / (R_in + eff) floored; destination receives out − fee_out.
describe("fixture_amm quote", () => {
  it("buy: USDC in (no fee), leg out with a 300 bps transfer fee", () => {
    const q = quoteFixtureSwap({ amountIn: 10_000_000n, inReserve: 1_000_000_000n, outReserve: 1_000_000_000_000n, lpFeeBps: 30, inFee: null, outFee: { bps: 300 } });
    const eff = (10_000_000n * 9970n) / 10_000n;
    const out = (1_000_000_000_000n * eff) / (1_000_000_000n + eff);
    expect(q).toBe(out - (out * 300n + 9999n) / 10_000n);
  });
  it("sell: leg in pays the transfer fee before the pool measures it", () => {
    const q = quoteFixtureSwap({ amountIn: 1_000_000_000n, inReserve: 10n ** 12n, outReserve: 10n ** 9n, lpFeeBps: 0, inFee: { bps: 100 }, outFee: null });
    expect(q).toBe((10n ** 9n * 990_000_000n) / (10n ** 12n + 990_000_000n));
  });
});
