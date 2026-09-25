// Spec 03 response shapes (docs/specs/03-valuation-api.md). The example responses are the contract.
export interface PricingBasis { kind: string; text: string }

export interface BasketResponse {
  cluster: string;
  program: string;
  basket: string;
  as_of_slot: number;
  pricing_basis: PricingBasis;
  share: { mint: string; decimals: number; supply_raw: string };
  legs: {
    index: number; symbol: string; fixture_mint: string; mirror_of: string;
    status: "active" | "unavailable" | "listing" | "retired"; unavailable_reason: "paused" | "hook" | "frozen" | null;
    balance_raw: string; accounted_raw: string; pending_raw: string; claim_units: string;
    per_share_raw: { num: string; den: string };
    multiplier: { stored: string; effective: string; effective_since: string | null; pending: unknown };
    shortfall: { since_inception_raw: string; last_event_slot: number | null };
  }[];
  values: {
    sell_now: {
      label: string; usd: string; method: string;
      legs: { index: number; usd: string; route: string; price_impact_bps: number; fee_bps: number; quoted_at_slot: number; source: string }[];
      unquotable_legs: number[];
    };
    last_trade: { label: string; usd: string; legs: { index: number; usd_per_raw: string; age_s: number; block: number; source: string }[]; oldest_age_s: number };
    reference: {
      label: string; usd: string;
      legs: { index: number; usd_per_ui: string; effective_multiplier: string; usd_per_raw: string; fetched_at: string; source: string }[];
    };
    gaps: { sell_now_vs_last_trade_bps: number; reference_vs_last_trade_bps: number };
  };
  weights: { inception: { index: number; value_share: string }[]; current_last_trade: { index: number; value_share: string }[] };
  warnings: string[];
  /** Set only by the in-app mock. */
  mock?: string;
}

export interface QuoteRedeemResponse {
  as_of_slot: number; shares_raw: string; mode: "in_kind" | "usdc";
  legs: ({ index: number; action: "pay"; gross_raw: string; fee_raw: string; net_raw: string; sell_now_usd: string } |
    // USDC mode (spec 03 as amended): available legs become pending sales.
    { index: number; action: "pending_sale"; units: string; gross_raw: string; fee_raw: string; sell_now_usd: string } |
    { index: number; action: "claim"; units: string; reason: string; note: string })[];
  totals: { sell_now_usd_paid_now: string; sell_now_usd_claims: string };
  mock?: string;
}

export interface QuoteDepositResponse {
  as_of_slot: number;
  usdc_raw: string;
  legs: { index: number; usdc_raw: string; expected_delta_raw: string; min_out_raw: string; route: string | { router: string; [k: string]: unknown } }[];
  expected_shares_raw: string;
  packing: number[][];
  mock?: string;
}

export interface IssuerEvent {
  kind: "FeeChangeScheduled" | "MultiplierChangeScheduled" | "Paused" | "Resumed" | "HookSet" | "DefaultStateChanged" | "MultisigConfigChanged";
  leg?: number; mint: string; network: "devnet" | "mainnet"; before: unknown; after: unknown; slot: number; signature?: string;
}
export interface EventsResponse { events: ({ type: "program"; name: string; slot: number; [k: string]: unknown } | ({ type: "issuer" } & IssuerEvent))[]; mock?: string }
