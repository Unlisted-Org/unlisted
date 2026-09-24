# Valuation API: where responses differ from the spec 03 examples

Agent C (ops), 2026-09-25. All but one change are additive; the example fields are all present, with the same names and meanings. B should know about these.

## The one new value: `action: "pending_sale"`

In `/v1/quote/redeem?mode=usdc`, each available leg has `action: "pending_sale"` instead of `"pay"`, with these fields:

- `units`
- `gross_raw`: the amount `settle_leg_usdc` would sell if settled now
- `fee_raw`
- `sell_now_usd`

This follows spec 01/02: in USDC mode every leg becomes `Claim { reason: PendingSale }`. Unavailable legs are still `"claim"`.

## Units and query parameters

- **Raw units.** `shares=` (redeem) and `usdc=` (deposit) are raw.
- **`/v1/events`** also accepts `since_mainnet_slot`. Mainnet and devnet slots aren't comparable, so each event carries `cluster`.

## Added fields

- **Top level** (every endpoint that reads the basket):
  - `basket_source {kind: program|standin, text}`: the stand-in basket is used until A's program is on devnet.
  - `as_of {slot, block_time, epoch, mainnet_slot, generated_at}`.
- **Per leg, in `/v1/basket`:**
  - `vault`, `listing`, `pending_norm`, `loss_index`, `loss_index_after_observe`, `unobserved_shortfall_raw`, `unobserved_surplus_raw`;
  - `per_share_ui` (display only);
  - `fee {now_bps, pending}`;
  - `shortfall.observed_raw`, `shortfall.unobserved_raw`;
  - `source`, `as_of_slot`.
- **In `values.sell_now`:**
  - `usd_paid_now`, which excludes legs that would become claims;
  - per leg: `amount_raw`, `out_usdc_raw`, `taker`, `taker_holds_input`, `quoted_at`, and `claim: true` on legs that would become claims;
  - on each `unquotable_legs` entry: `kind` (`no_route` or `upstream_error`).
- **In `values.last_trade` and `values.reference`, per leg:** `usd`, `block_time`, `usd_per_unscaled_token`, and `multiplier_source`.

## Quote routes

Quotes exclude Manifest and 1DEX (spec 02, Router route rules).

## Hosting

- Port 8905 by default.
- `/v1/basket` is recomputed every 30 s and served warm. `?fresh=1` recomputes on demand, which takes about 30–70 s because of Jupiter's keyless rate limits.
