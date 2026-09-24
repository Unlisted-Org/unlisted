// Valuation API client (spec 03). With no API configured, a mock fills the spec 03 shape: raw
// fields from the same chain reads the app already made, prices as labelled PLACEHOLDERS.
// Every mocked value carries `mock`, and the UI prints that label beside it.
import type { BasketView } from "@stocklana/sdk";
import { math } from "@stocklana/sdk";
import type { BasketResponse, EventsResponse, QuoteDepositResponse, QuoteRedeemResponse } from "./types";

export interface Valuation {
  basket(view: BasketView): Promise<BasketResponse>;
  quoteRedeem(view: BasketView, shares: bigint, mode: "in_kind" | "usdc"): Promise<QuoteRedeemResponse>;
  quoteDeposit(view: BasketView, usdc: bigint): Promise<QuoteDepositResponse>;
  events(sinceSlot: number): Promise<EventsResponse>;
  readonly isMock: boolean;
}

export class HttpValuation implements Valuation {
  readonly isMock = false;
  constructor(private readonly base: string) {}
  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.base.replace(/\/$/, "")}${path}`);
    if (!r.ok) throw new Error(`valuation API ${path}: HTTP ${r.status}`);
    return r.json();
  }
  basket() { return this.get<BasketResponse>("/v1/basket"); }
  quoteRedeem(_v: BasketView, shares: bigint, mode: "in_kind" | "usdc") { return this.get<QuoteRedeemResponse>(`/v1/quote/redeem?shares=${shares}&mode=${mode}`); }
  quoteDeposit(_v: BasketView, usdc: bigint) { return this.get<QuoteDepositResponse>(`/v1/quote/deposit?usdc=${usdc}`); }
  events(sinceSlot: number) { return this.get<EventsResponse>(`/v1/events?since_slot=${sinceSlot}`); }
}

const MOCK_LABEL = "MOCK: valuation API (Agent C) not connected. Prices are placeholders in spec 03's shape, not market data.";
/** Placeholder USD per UI token for each leg, by index. Deliberately round: they are not prices. */
const PLACEHOLDER_USD_PER_UI = [1000, 1000, 100, 100, 10, 10, 10];
/** Gaps from spec 03's example response. */
const EXAMPLE_GAPS = { sell_now_vs_last_trade_bps: -330, reference_vs_last_trade_bps: -290 };

export class MockValuation implements Valuation {
  readonly isMock = true;
  private usdPerRaw(i: number, mult: number) { return (PLACEHOLDER_USD_PER_UI[i] ?? 10) * mult / 1e9; }

  async basket(v: BasketView): Promise<BasketResponse> {
    const S = v.shareSupply;
    const now = new Date().toISOString();
    const perShare = v.legs.map((l) => math.perShare(l.state, S));
    const oneShareRaw = perShare.map((p) => (p.den === 0n ? 0n : (p.num * 1_000_000_000n) / p.den));
    const lastTradeLegs = v.legs.map((l, i) => ({ index: i, usd_per_raw: String(this.usdPerRaw(i, l.multiplier)), age_s: 42, block: v.slot, source: MOCK_LABEL }));
    const ltUsd = v.legs.map((l, i) => Number(oneShareRaw[i]) * this.usdPerRaw(i, l.multiplier));
    const sellUsd = v.legs.map((l, i) => (l.unavailable.length ? 0 : ltUsd[i] * (1 + EXAMPLE_GAPS.sell_now_vs_last_trade_bps / 10_000)));
    const refUsd = ltUsd.map((x) => x * (1 + EXAMPLE_GAPS.reference_vs_last_trade_bps / 10_000));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return {
      cluster: "mock", program: v.config.programId.toBase58(), basket: v.address.toBase58(), as_of_slot: v.slot,
      pricing_basis: { kind: "mainnet_mirror", text: "Balances are the devnet basket's. Prices are mainnet market data for the real PreStocks token each fixture mirrors." },
      share: { mint: v.basket.shareMint.toBase58(), decimals: 9, supply_raw: S.toString() },
      legs: v.legs.map((l, i) => ({
        index: i, symbol: l.symbol, fixture_mint: l.mint.toBase58(), mirror_of: l.mirrorOf.toBase58(),
        status: l.unavailable.length ? "unavailable" : "active", unavailable_reason: (l.unavailable[0] as any) ?? null,
        balance_raw: l.state.balance.toString(), accounted_raw: l.state.accounted.toString(), pending_raw: math.pendingActual(l.state).toString(),
        claim_units: l.state.claimUnits.toString(), per_share_raw: { num: perShare[i].num.toString(), den: perShare[i].den.toString() },
        multiplier: { stored: String(l.mintInfo.scaledUi?.multiplier ?? 1), effective: String(l.multiplier), effective_since: null, pending: null },
        shortfall: { since_inception_raw: "0", last_event_slot: null },
      })),
      values: {
        sell_now: {
          label: "If you redeemed now", usd: sum(sellUsd).toFixed(2), method: MOCK_LABEL,
          legs: v.legs.map((l, i) => ({ index: i, usd: sellUsd[i].toFixed(2), route: "mock", price_impact_bps: 0, fee_bps: l.feeNow?.bps ?? 0, quoted_at_slot: v.slot, source: MOCK_LABEL })),
          unquotable_legs: v.legs.filter((l) => l.unavailable.length).map((l) => l.index),
        },
        last_trade: { label: "Last trade", usd: sum(ltUsd).toFixed(2), legs: lastTradeLegs, oldest_age_s: 42 },
        reference: {
          label: "PreStocks reference (off-chain estimate, not tradable)", usd: sum(refUsd).toFixed(2),
          legs: v.legs.map((l, i) => ({ index: i, usd_per_ui: String(PLACEHOLDER_USD_PER_UI[i] * (1 + EXAMPLE_GAPS.reference_vs_last_trade_bps / 10_000)),
            effective_multiplier: String(l.multiplier), usd_per_raw: String(this.usdPerRaw(i, l.multiplier)), fetched_at: now, source: MOCK_LABEL })),
        },
        gaps: EXAMPLE_GAPS,
      },
      weights: { inception: v.legs.map((l) => ({ index: l.index, value_share: (1 / 7).toFixed(6) })), current_last_trade: v.legs.map((l, i) => ({ index: i, value_share: (ltUsd[i] / (sum(ltUsd) || 1)).toFixed(6) })) },
      warnings: [],
      mock: MOCK_LABEL,
    };
  }

  async quoteRedeem(v: BasketView, shares: bigint, mode: "in_kind" | "usdc"): Promise<QuoteRedeemResponse> {
    const out = math.redeemInKind(v.legs.map((l) => l.state), v.shareSupply, shares, v.legs.map((l) => l.feeNow));
    return {
      as_of_slot: v.slot, shares_raw: shares.toString(), mode,
      legs: out.map((o, i) => o.action === "pay"
        ? { index: i, action: "pay" as const, gross_raw: o.gross.toString(), fee_raw: o.fee.toString(), net_raw: o.net.toString(), sell_now_usd: (Number(o.net) * this.usdPerRaw(i, v.legs[i].multiplier)).toFixed(2) }
        : { index: i, action: "claim" as const, units: shares.toString(), reason: v.legs[i].unavailable[0] ?? "", note: "Paid in kind after the leg is available again; shares the leg's gains and losses until then." }),
      totals: { sell_now_usd_paid_now: "…", sell_now_usd_claims: "…" },
      mock: MOCK_LABEL,
    };
  }

  async quoteDeposit(v: BasketView, usdc: bigint): Promise<QuoteDepositResponse> {
    // Split proportional to one share's per-leg value (spec 03), with the placeholder prices.
    const b = await this.basket(v);
    const w = b.values.last_trade.legs.map((_, i) => Number(b.values.sell_now.legs[i].usd) || 0);
    const tot = w.reduce((a, c) => a + c, 0) || 1;
    const split = w.map((x) => (usdc * BigInt(Math.floor((x / tot) * 1e6))) / 1_000_000n);
    return { as_of_slot: v.slot, usdc_raw: usdc.toString(), legs: split.map((s, i) => ({ index: i, usdc_raw: s.toString(), expected_delta_raw: "…", min_out_raw: "…", route: "mock" })),
      expected_shares_raw: "…", packing: [], mock: MOCK_LABEL };
  }

  async events(): Promise<EventsResponse> {
    return { events: [], mock: MOCK_LABEL };
  }
}
