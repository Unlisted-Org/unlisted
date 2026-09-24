# Spec 03: Valuation API

Status: **draft for agreement.** Agent C implements the service (`services/valuation/`). Agent B consumes it, and before C ships, B builds against the example responses in this document.

## Principles

1. **Three labelled values, never one "price".** Each value is named for what it is and carries its own freshness. The gaps between the values are part of the response, not hidden.
2. **Raw units in, raw units out.** Every price in the API is **per raw unit**: USD per 10⁻⁹ of the token, no multiplier applied. Display fields apply the **effective** multiplier explicitly.
   - Mixing per-raw and per-UI prices is the bug class that values SpaceX 5× wrong. Here it is ruled out by the schema: raw and display fields have different names.
3. **Every number states where and when it was read.** Every figure carries `source` and `as_of` (a slot, or an ISO time for off-chain sources). A figure with no `as_of` is a schema violation.
4. **Devnet honesty.** Balances and shares come from the **devnet** basket. Prices come from the **mainnet market for the real token** that each fixture mirrors (`leg.mirror_of`). Every response carries `pricing_basis` saying so. The UI prints it on every screen that shows a value.

## Endpoints

| Method and path | Purpose |
|---|---|
| `GET /v1/basket` | Basket state plus the three values for **one whole share** |
| `GET /v1/position/{owner}` | Shares and open tickets and claims for one wallet, valued at **that wallet's size** |
| `GET /v1/quote/redeem?shares=&mode=in_kind\|usdc` | Exactly what redeeming `shares` now would pay per leg, including claims that would be created |
| `GET /v1/quote/deposit?usdc=` | Per-leg USDC split, expected deltas, `min_out`s and expected shares for a ticket deposit |
| `GET /v1/capacity?max_round_trip_bps=` | Largest per-leg and per-basket size under the round-trip threshold |
| `GET /v1/events?since_slot=` | Program events (`ShortfallObserved`, `ClaimCreated`, …) and issuer events (below), newest first |
| `GET /v1/issuer` | Live issuer controls per leg, for both the fixture and the mirrored mainnet mint |

## Schema: `GET /v1/basket`

```jsonc
{
  "cluster": "devnet",
  "program": "<basket program id>",
  "basket": "<Basket PDA>",
  "as_of_slot": 503600000,
  "pricing_basis": {
    "kind": "mainnet_mirror",
    "text": "Balances are the devnet basket's. Prices are mainnet market data for the real PreStocks token each fixture mirrors."
  },
  "share": { "mint": "…", "decimals": 9, "supply_raw": "1000000000" },
  "legs": [
    {
      "index": 0,
      "symbol": "OPENAI",
      "fixture_mint": "…",
      "mirror_of": "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
      "status": "active",                        // active | unavailable | listing | retired
      "unavailable_reason": null,                // paused | hook | frozen
      "balance_raw": "…",                        // B_i, read at as_of_slot
      "accounted_raw": "…",                      // A_i from the Basket account
      "pending_raw": "…",
      "claim_units": "…",
      "per_share_raw": { "num": "…", "den": "…" },  // exact ratio owned_i / (S + C_i); never pre-rounded
      "multiplier": {
        "stored": "1",
        "effective": "1.4861347",
        "effective_since": "2026-07-17T16:30:00Z",
        "pending": null
      },
      "shortfall": { "since_inception_raw": "0", "last_event_slot": null }
    }
  ],
  "values": {
    "sell_now": {
      "label": "If you redeemed now",
      "usd": "…",
      "method": "sum over legs of live fee-inclusive sell quotes for one share's raw amount of the mirrored mainnet token, excluding Manifest",
      "legs": [
        { "index": 0, "usd": "…", "route": "Meteora DLMM", "price_impact_bps": 3, "fee_bps": 100,
          "quoted_at_slot": 450100000, "source": "jupiter swap/v2 build (mainnet)" }
      ],
      "unquotable_legs": []                      // legs with no route: valued at 0 here and listed by name
    },
    "last_trade": {
      "label": "Last trade",
      "usd": "…",
      "legs": [
        { "index": 0, "usd_per_raw": "…", "age_s": 42, "block": 450099900,
          "source": "jupiter price v3 usdPricePrescaled (mainnet)" }
      ],
      "oldest_age_s": 4538
    },
    "reference": {
      "label": "PreStocks reference (off-chain estimate, not tradable)",
      "usd": "…",
      "legs": [
        { "index": 0, "usd_per_ui": "1023.06", "effective_multiplier": "1.4861347", "usd_per_raw": "…",
          "fetched_at": "2026-09-24T16:09:09Z", "source": "prestocks.com/api/prestocks markPrice" }
      ]
    },
    "gaps": { "sell_now_vs_last_trade_bps": -330, "reference_vs_last_trade_bps": -290 }
  },
  "weights": {
    "inception": [ { "index": 0, "value_share": "0.142857" } ],
    "current_last_trade": [ { "index": 0, "value_share": "…" } ]
  },
  "warnings": [ "FIGUREAI last trade is 75 min old" ]
}
```

### Rules for each value

**`sell_now`**
- For each leg, quote selling the relevant raw amount of the **mirrored mainnet mint** to USDC using `api.jup.ag/swap/v2/build` with `excludeDexes=Manifest`.
  - Manifest is excluded because its quotes ignore the transfer fee: [Bonasa-Tech/manifest#735](https://github.com/Bonasa-Tech/manifest/issues/735). Remove the exclusion only after that issue is fixed **and** C re-proves quote-equals-delivery by simulation.
- `usd` is the quote's output, which already includes the 1% transfer fee on the vault-to-pool hop.
- A leg with no route is valued at **0** and listed in `unquotable_legs`. It is never interpolated.
- In `/v1/position` and `/v1/quote/redeem`, the size is the caller's actual share of each leg, not one share.

**`last_trade`**
- `usdPricePrescaled` (USD per raw unit) from Jupiter price v3 for the mirrored mint.
- `age_s` = current time − `getBlockTime(blockId)`. Don't convert slots at an assumed rate: slots currently take ≈ 0.266 s, not the commonly assumed 0.4 s, which overstated ages by 1.5× in Phase 0.
- `oldest_age_s` drives a warning above 15 minutes.

**`reference`**
- PreStocks `markPrice` is USD per **UI** token. Convert with `usd_per_raw = markPrice × effective_multiplier / 10⁹`.
- The response has no timestamp, so `fetched_at` is when C fetched it.
- The label must include "not tradable".

**`per_share_raw`** is an exact ratio `{num, den}`. Clients divide only for display.

### Effective multiplier rule (single implementation, in C's code only)

```
effective = (now >= newMultiplierEffectiveTimestamp) ? newMultiplier : multiplier
```

This is read from the **mint account's** `scaledUiAmountConfig`: the fixture mint for fixture display, and the mainnet mint for mainnet prices. A pending change (timestamp in the future) is reported under `multiplier.pending` and in `/v1/events`, with its effective time.

## `GET /v1/quote/redeem?shares=S&mode=…`

```jsonc
{
  "as_of_slot": …, "shares_raw": "…", "mode": "in_kind",
  "legs": [
    { "index": 0, "action": "pay",   "gross_raw": "…", "fee_raw": "…", "net_raw": "…", "sell_now_usd": "…" },
    { "index": 3, "action": "claim", "units": "…", "reason": "paused",
      "note": "Paid in kind after the leg is available again; shares the leg's gains and losses until then." }
  ],
  "totals": { "sell_now_usd_paid_now": "…", "sell_now_usd_claims": "…" }
}
```

In `mode=usdc`, every available leg has **`"action": "pending_sale"`** with `units`, and the expected USDC from the leg's quote. This matches spec 02: in USDC mode every leg becomes a `Claim { PendingSale }` settled by a sale. Ratified 2026-09-25 from Agent C's `docs/reports/2026-09-25-ops-api-additions.md` on `ops`, where the other API additions are listed and accepted as additive.

`gross_raw` must equal the program's `floor(s × owned_i / (S + C_i))` at `as_of_slot` exactly. C's test compares it against the reference model and against a devnet `redeem` transaction's measured payout.

## `GET /v1/quote/deposit?usdc=U`

- The USDC split per leg is proportional to one share's per-leg `sell_now` value. The aim is for the deltas to land in the current per-share composition, which keeps the residual to slippage.
- Returns, per leg: the USDC slice, expected delta, `min_out` (default slippage 150 bps; C documents the choice), and route summary.
- Also returns expected shares, and the packing of legs into transactions (4 per transaction by default).
- On devnet the routes are `fixture_amm` pools. Their prices are seeded from the same mainnet `last_trade` source and the response says so.

## `GET /v1/issuer`

For each leg, for both the fixture and the mirrored mainnet mint:
- fee bps now and pending (with effective epoch);
- paused;
- hook program id;
- default account state;
- permanent delegate;
- effective and pending multiplier;
- the controlling multisig and its threshold (mainnet: Squads `53Ab3Rqx…`, 2-of-7, time lock 0).

## Issuer events in `/v1/events`

C's watcher polls mainnet and devnet mints. It emits one event per change, with the before and after values and the slot of the transaction that made it:
- `FeeChangeScheduled`
- `MultiplierChangeScheduled`
- `Paused` / `Resumed`
- `HookSet`
- `DefaultStateChanged`
- `MultisigConfigChanged`

These are the same events the app shows as banners.

## Acceptance (C's "proven" bar)

1. **Values match live reads.** For one stated devnet slot and one stated mainnet slot, every raw number in `/v1/basket` matches a direct RPC read, and every `sell_now` leg matches a `simulateTransaction` of the quoted route to within ±0.1%. The check fails if either side is recomputed from the other.
2. **Redeem quotes match the program.** `/v1/quote/redeem` equals the devnet `redeem` transaction's measured payout for the same shares, per leg, to the unit.
3. **Multiplier handling is proven.** A multiplier change on a fixture (issuer scenario suite) changes **only display fields** (`legs[].multiplier`, per-share UI amounts), and **only after** the effective timestamp. **Raw fields and every USD value (`sell_now`, `last_trade`, `reference`) must not change.**
   - A multiplier change never changes what raw holdings are worth. USD values are priced per raw unit from the mirrored mainnet mint, whose own multiplier governs the mainnet price.
   - Corrected 2026-09-25: the first version wrongly required `reference.usd` to move. Raised by Agent C in `docs/reports/2026-09-25-ops-multiplier-acceptance.md` on `ops`.
