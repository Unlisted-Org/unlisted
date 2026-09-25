---
title: Core concepts
description: Shares, legs, claim units, the loss index, pending deposits and sales, availability, and the three labelled values.
---

The share maths was written first as an executable model, `spec/model/basket_model.py`, with 17 property tests. Spec 01 says that when the spec text and the model disagree, the model is right. The program (`programs/basket/src/lib.rs`) follows the model to the unit.

## Raw units

Every amount in the program is a **raw token amount**: an unsigned 64-bit integer. All seven legs and the share token have **9 decimals**, so 1,000,000,000 raw is one whole token or one whole share. Fixture USDC has 6 decimals.

The **scaled-UI multiplier** that PreStocks sets on a mint (OpenAI's is 1.4861347) is **display only**. It never enters the program; raw balances and raw per-share amounts are the only quantities. The valuation API applies the *effective* multiplier for display: the new multiplier once its effective timestamp has passed, the old one before. Reading the stored `multiplier` field alone would value OpenAI 1.486× wrong.

## Shares

A share is a classic SPL token (`HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj` for the canonical devnet basket) whose mint authority is the basket's program address. `S` is its total supply, read from the mint, never stored.

A share is a claim on a fixed fraction of every leg. There is no rebalancing: after bootstrap the vault holds fixed raw quantities per share, and value weights drift with performance. Only the IPO rule (below) changes the composition.

## Legs

A **leg** is one constituent: its mint, its vault token account (owned by the basket's program address, created once at initialization and never re-created), and the numbers the program keeps for it.

| Symbol | Name in the program | Meaning |
|---|---|---|
| `B_i` | *(never stored)* | The vault's **actual** balance, read from the token account on every instruction. Withheld fees are excluded, as Token-2022 does. |
| `A_i` | `accounted` | What the program expects `B_i` to be after its own transfers. |
| `C_i` | `claim_units` | Claim units: shares already burned that are still owed this leg. |
| `P_i` | `pending_norm` | Open deposit tickets' share of this leg, stored divided by `L_i`. |
| `L_i` | `loss_index` | The loss index; `1.0` is 10¹⁸. |
| | `status` | `Active`, `Listing { convert_after, deadline }` or `Retired`. |
| | `mirror_of` | The mainnet PreStocks mint this fixture mirrors (display only). |

Derived, never stored:

```
pending_i = P_i × L_i / 10^18        open tickets' current entitlement
owned_i   = B_i − pending_i          what belongs to shares and claims
per-share amount of leg i = owned_i / (S + C_i)
```

The per-share amount is kept as an exact ratio and never rounded and stored.

## Claim units

When a redemption can't pay a leg, the leg becomes a **claim** for the burned shares: `C_i` grows by that many units. Claim units sit in the denominator next to `S`, so the claim keeps its fraction of that leg exactly as if the shares hadn't been burned. It gains and loses with the leg, including through a seizure, until it settles.

A claim is **owed one leg only** and can't be transferred in v1. Details: [Claims and settlement](/protocol/claims/).

## The loss index

`L_i` starts at 1.0 and moves down with every observed shortfall: `L_i ← floor(L_i × B_i / A_i)`. It exists for one group, open deposit tickets, whose tokens sit in the vault but aren't yet shares. Holders and claimants already feel a shortfall through `owned_i`; tickets feel it through `L_i`. Everyone loses the same fraction, and the floor means an open ticket never escapes a shortfall.

On devnet, a 25% seizure of NEURALINK moved its loss index to exactly 0.75 (`ShortfallObserved`, `tests/program/devnet/seizure.json`).

## Pending deposits and pending sales

- **A pending deposit** is a USDC deposit ticket whose legs are landing in the vault. Each landed amount is credited to the ticket as `floor(Δ_i × 10^18 / L_i)` and added to `P_i`. When the ticket finalizes, its entitlement is recomputed as `norm × L_i / 10^18`, so a shortfall during the ticket is shared.
- **A pending sale** is a leg of a USDC-mode redemption. It is a claim with reason `PendingSale`: units, not an amount, sold by the owner through the router with `settle_leg_usdc`. If no route works, the owner can settle it in kind instead.

## Availability

A leg is **unavailable** when any of these holds. The program reads them live from the mint's extension data and the vault account in every instruction that moves the leg, never from a client's flag.

| Condition | Claim reason | Why it matters |
|---|---|---|
| The mint's `PausableConfig.paused` is true | `Paused` | Token-2022 rejects every transfer (`MintPaused`, 0x43). |
| The mint's `TransferHook` program id isn't null | `Hook` | The program would have to forward accounts to a hook it hasn't reviewed. It refuses rather than guess. |
| The vault token account is frozen | `Frozen` | The issuer's freeze authority froze it (`AccountFrozen`, 0x11). |

While any leg is unavailable: deposits of any kind are refused, redemptions go ahead and pay what they can, and claims wait. If a hook were switched on permanently, claims on that leg couldn't settle until a program upgrade adds reviewed hook support; that is a governance action.

## The three values

**The program has no price.** The app shows three labelled values from the valuation API, each with its own source and age, and never a single "true price". The gaps between them are shown, not hidden.

| Value | What it is | Source |
|---|---|---|
| **If you redeemed now** | Live, fee-inclusive sell quotes for *your* share of each leg, at *your* size. A leg with no route counts as 0 and is listed by name. | Jupiter swap v2 quotes on mainnet for the real token each fixture mirrors, excluding Manifest (its quotes ignore the transfer fee) |
| **Last trade** | Each leg's last traded price, with its age. A warning appears when the oldest is more than 15 minutes old. | Jupiter price v3 `usdPricePrescaled` (mainnet) |
| **PreStocks reference** | The issuer's off-chain secondary-market estimate, labelled *not tradable* | PreStocks `markPrice` |

**Devnet honesty.** Balances and shares come from the devnet basket; prices come from the mainnet market for the real token each fixture mirrors. Every response carries a `pricing_basis` saying so, and the app prints it wherever it shows a value.

**An example read.** In the fresh-wallet browser run of 2026-09-25 10:43 UTC, the app showed, for one whole share: $508.40 if redeemed now, $707.88 at last trade, and $652.03 by PreStocks' reference. The test confirmed these were exactly the API's figures, read at devnet slot 503,949,589 and mainnet slot 450,328,989 (`web/e2e/holder/runs/2026-09-25-devnet.json`). The values move with the market; these are a snapshot, not a quote.

## The IPO rule

When a constituent company lists, its PreStock stops being "not yet public" and usually gets a conversion deadline. The rule, as the program implements it:

1. **Notice.** The basket authority calls `flag_listing(leg, convert_after, deadline)`. `convert_after` must be at least 7 days away, and `deadline` at least 7 days after `convert_after` (`ListingNoticeTooShort` otherwise). It emits `LegListing` and can be cancelled only before `convert_after`.
2. **Holder choice.** During the notice, any holder can redeem in kind and convert the PreStock themselves.
3. **Conversion.** After `convert_after`, and only once the leg has no open claims (`OutstandingClaims`), **anyone** can call `convert_listed_leg` to sell a chunk (at most `max_convert_chunk`) into the basket's USDC reserve. Redemptions during conversion receive a pro-rata share of the reserve. When the leg's `owned_i` reaches zero it is marked `Retired`.
4. **Reinvestment.** Anyone can call `reinvest_reserve`, which buys each remaining active leg with an equal slice of the reserve.

This path was run end to end on a mainnet fork with ANDURIL as the listed leg: conversion before the notice ended was refused (`0x177a`, which is 6010 `ConversionNotOpen`), and after a time jump the leg was converted, retired, and the reserve reinvested down to 0 (`tests/program/fork/transcript-final7.json`). It isn't on devnet. SpaceX is the worked case in spec 01: it listed before v1 launched, so it simply isn't a constituent.

<div class="sources">

Sources: `docs/specs/01-shares-and-pricing.md`; `docs/specs/02-onchain-interface.md` (*Accounts*, *Availability check*); `docs/specs/03-valuation-api.md`; `spec/model/basket_model.py`; `programs/basket/src/state.rs`, `lib.rs`, `tok.rs`; `tests/program/devnet/seizure.json`; `tests/program/fork/transcript-final7.json`; `web/e2e/holder/runs/2026-09-25-devnet.json`.

</div>
