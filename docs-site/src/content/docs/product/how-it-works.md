---
title: How it works
description: Deposits in kind and through a USDC ticket, redemptions, the paused-leg path, seizure handling, transfer fees, rounding, and what it costs.
---

The vault holds seven legs. A **share** is a claim on a fixed fraction of each leg's holdings. Everything below is computed from the vault's real token balances, never from a price. The symbols are defined on [Core concepts](/product/concepts/); the account-level detail is on [The protocol flow](/protocol/flow/).

## Deposits

A deposit is refused while **any** leg is unavailable (paused, frozen, or with a transfer hook set), with `LegUnavailable`. It is also refused while the basket authority has stopped new deposits (`DepositsDisabled`). Redemptions are never refused for either reason.

### In kind

The depositor sends some amount of every active leg into the vault in one instruction, `deposit_in_kind`.

1. The program measures each leg's **net** arrival, `Δ_i`: the vault balance after, minus before. The transfer fee is whatever Token-2022 withheld; nothing about the fee is stored.
2. It mints the smallest share amount any leg supports:

   ```
   m = min over active legs of floor( Δ_i × (S + C_i) / (owned_i − Δ_i) )
   ```

   `owned_i − Δ_i` is what the vault owned before this deposit, so each leg's candidate is "the deposit's fraction of that leg, times the shares outstanding".
3. It refuses with `SlippageExceeded` if `m` is below the caller's `min_shares` (or below 1).

Delivering more of one leg than the binding minimum leaves the excess in the vault, where it accrues to all holders. Clients size deposits to the current per-share composition so the excess stays small.

**On devnet, in a real browser:** a wallet created for the run deposited in kind and received 79,622,660 raw shares, exactly the number the app predicted before signing: [`2smfMbGR…QwM4QxmB`](https://explorer.solana.com/tx/2smfMbGR9WfU2D2aFd9EyvhbzRtyBpPM9sT8rGoBdqHLYUG8BKNHEvzmt1HJnb8Nc9VPV6fEF5nrQkwRQwM4QxmB?cluster=devnet "slot 503950052").

### With USDC: the deposit ticket

For a user holding USDC, a **deposit ticket** buys each leg straight into the vault and mints shares once all seven have landed.

1. **`open_deposit_ticket`** escrows the user's USDC in an account owned by the ticket. The ticket expires after at most 1,500 slots (≈ 6.6 minutes at the measured 0.2657 s per slot).
2. **`ticket_swap_leg`**, once per leg, swaps part of the escrow through a router in the basket's allowlist, with the output going **directly into the vault** for that leg. The program measures the vault's change around the swap, checks it against the caller's `min_out`, and credits the ticket.
3. **`finalize_deposit`** requires every active leg to have landed. It applies the same share formula as an in-kind deposit, mints the shares, refunds leftover USDC, and closes the ticket and every ticket-owned account passed to it, with the rent going back to the owner.
4. **If it can't finish:** `unwind_leg` sells each landed leg back into the escrow, then `abort_deposit` refunds the escrow and closes the ticket.

While a ticket is open, the legs it has bought sit in the vault but belong to the ticket, and they bear any seizure pro rata like everyone else ([pending deposits](/product/concepts/#pending-deposits-and-pending-sales)).

**How many transactions:**
- **On devnet**, where the router is the project's own `fixture_amm` pools, a 10 USDC deposit in the browser took **2** transactions under one wallet approval: [`4jMWFK8f…R89KwSvq`](https://explorer.solana.com/tx/4jMWFK8fA6ePKr5BCasCdsHePJ4K3wQaHK5kYHSU9vLbb4nET47oWVdbv6CL6ncVkVoxW7Dacmciju7HR89KwSvq?cluster=devnet), [`wkkqRHLk…fctSb8oS`](https://explorer.solana.com/tx/wkkqRHLkFSMdcd1a82WxRn3fmGkZ4T7idq8QAJMEjm3oEUQ4yAkYXV49PGGbc6tKKikgf5GDacrhnRBfctSb8oS?cluster=devnet "slot 503950237"). It minted 13,798,984 raw shares for 9,999,996 raw USDC, and no ticket-owned account was left open afterwards.
- **On a mainnet fork**, with the real PreStocks mints and live Jupiter routes, a full USDC deposit took **4** transactions, all landing first try. At most three legs fit in one transaction; the byte limit binds before the account-lock limit ([The protocol flow](/protocol/flow/#transaction-sizes)).

### Bootstrap

The first deposit into an empty basket sets the composition. Only the basket authority can make it, once, in kind, and it always mints exactly **1.0 share** (`INITIAL_SHARES` = 1,000,000,000 raw).

For the canonical devnet basket, the recorded inception pricing is **$100 per leg**, priced from Jupiter's last-trade price (price v3 `usdPricePrescaled`, mainnet) for the real token each fixture mirrors (`tests/program/devnet/canonical.json`, `inceptionPricing`). After bootstrap the program never uses a price again.

## Redemptions

`redeem(shares, mode)` burns the shares and creates a **redemption ticket** that records what each leg did. For every active leg:

- **If the leg is available** and the mode is **in kind**, it pays now:

  ```
  gross_i = floor( shares × owned_i / (S + C_i) )
  ```

  where `S` is the share supply **before** the burn. The recipient receives `gross_i` minus the transfer fee, and the ticket records both numbers.
- **If the leg is available** and the mode is **USDC**, the leg becomes a *pending sale*: a claim of `shares` units that the owner settles by selling through the router (`settle_leg_usdc`). Nothing is fixed as an amount until the sale, so a USDC redemption obeys the same pro-rata rule as everything else.
- **If the leg is unavailable,** the leg becomes a **claim** of `shares` units, and the program emits `ClaimCreated`.

**A redemption never fails because a leg is unavailable.** Several legs can be unavailable at once; each becomes its own claim.

The remaining holders lose nothing: a paid leg is floored, so their per-share amount can only rise, and a claimed leg keeps their per-share amount exactly where it was.

## The paused-leg path

A claim is owed **one leg only**, in units of burned shares. It isn't a fixed amount: it shares that leg's gains and losses, including any seizure, until it settles. Once the leg is available again, **anyone** can call `settle_claim`, which pays `floor(units × owned_i / (S + C_i))` in kind to the claim's owner.

The whole path, signed on devnet in a real browser, is on [The user flow](/product/user-flow/). The rules are on [Claims and settlement](/protocol/claims/).

## Seizure handling

The issuer's permanent delegate can burn or move tokens out of the vault without the vault signing. The program never trusts its own records over the chain:

1. Every instruction that touches a leg first runs **`observe`** on it: it reads the vault's actual balance `B_i` and compares it with the accounted balance `A_i`.
2. **If `B_i < A_i`,** the difference is a shortfall. The leg's **loss index** falls to `floor(L_i × B_i / A_i)`, and the program emits `ShortfallObserved { leg, expected, actual, loss_index, slot }`.
3. **If `B_i > A_i`,** the difference (a donation, say) is a surplus. It accrues to holders and claimants, not to open deposit tickets, and the program emits `SurplusObserved`.
4. Then `A_i ← B_i`.

Holders and claimants bear a shortfall through the per-share amount `owned_i / (S + C_i)`, which shrinks with `B_i`. Open deposit tickets bear it through the loss index. Everyone loses the same fraction. **No later depositor makes anyone whole:** a later deposit mints at the reduced composition.

`observe` is also a standalone instruction that **anyone** can call, so a drop can be recorded and shown before anyone transacts.

**Signed on devnet** (`tests/program/devnet/seizure.json`):

| Step | Transaction |
|---|---|
| The fixture issuer burns 371,250,000,000 raw NEURALINK (25%) from the vault, without the vault signing | [`RdiTG5Mn…VEp83GCL`](https://explorer.solana.com/tx/RdiTG5MnYvPmLiHkKPjrhPbhKmMaRhWaoLcMSHXCtDUaayE5CDUiiyVe1v9oLDxNfygk4b9Z1G3W8Q2VEp83GCL?cluster=devnet "slot 503654088") |
| `observe`, called by anyone, emits `ShortfallObserved`: expected 1,485,000,000,000, actual 1,113,750,000,000, loss index 0.75 | [`4NHSajqy…FbJmnZos`](https://explorer.solana.com/tx/4NHSajqyThX7Ai4B3Ye8R88GZLwYHjYgm9CLok4wCnyz7HJN6Zq9ZjbewJHJ8a7igcd1tCbuKvAJPLo6FbJmnZos?cluster=devnet "slot 503654111") |
| A redemption of 0.25 share (of 1.5 outstanding): six legs pay 247,500,000,000 gross each; NEURALINK pays 185,625,000,000, exactly 75% of that | [`3GyqdBmr…qBjv7Z7k`](https://explorer.solana.com/tx/3GyqdBmrRr8cq8x1cwUmXcKFppE5K4yXtj13Be3m64tUaBPJ26smyBy3jRLPd2N6gQvTNS8qd3oRdvkaqBjv7Z7k?cluster=devnet "slot 503654345") |
| A later depositor mints 125,000,000 raw shares (0.125 share), delivering 92,812,500,000 NEURALINK against 123,750,000,000 of each other leg: no top-up of the seized leg | [`4Da6fji7…e9vHLg56`](https://explorer.solana.com/tx/4Da6fji7UkogJnHrokSiAdnZsT68w57tY4SphLzGDzNh37Kfu8s7jBKDL7EPNuPxMRp7HxDVj1ord4Tae9vHLg56?cluster=devnet "slot 503654602") |

## Transfer fees

The fee is **never stored**. Every inflow is credited at its measured net arrival, and every outflow's fee falls on its recipient: the redeemer in kind, or the pool in a sale. A fee change in the middle of a position changes nothing in the accounting.

On devnet the fixture fee change 100 → 300 bps was scheduled with a position open, and a redemption before it took effect paid under the older 100 bps (`tests/program/devnet/fee-change-mid-position.json`). The second half, a redemption **after** the new fee is in force (devnet epoch 1167), **is not yet proven**: the epoch hadn't begun when the records were written.

## Rounding

Every division floors, in the vault's favour: shares minted, amounts redeemed, claim payouts, ticket credits and the loss index. Division happens in 128-bit integers after multiplication. Any leftover unit stays in the vault and accrues to all holders.

The reference model (`spec/model/`) checks this across 300 random sequences of mints, redeems, pauses, seizures, donations, tickets and fee changes: the total everyone is owed never exceeds the vault's balance for any leg, and mints and redeems never lower the remaining holders' per-share amount.

## What it costs

**Minting or redeeming Unlisted is never cheaper than buying the seven tokens directly.** At best it costs the same. Every deposit and every redemption moves each leg through the vault and pays the issuer's transfer fee on each move.

| Transfer fee | Round trip, fees alone |
|---|---|
| 100 bps (in force until epoch 1043) | 1.99% |
| 300 bps (scheduled from epoch 1043) | `1 − 0.97²` = **5.91%** |

**With market spread** (measured on 2026-09-24): about 0.5% at $10, 1.3% at $1k and 2.0% at $10k. Estimated round trips at 300 bps are therefore **≈ 6.5%, 7.2% and 7.9%**. This is arithmetic on measured spreads, to be re-measured after epoch 1043.

The convenience (one transferable token and one account instead of seven) is real but secondary. Trading the Unlisted share token itself pays no PreStocks fee.

<div class="sources">

Sources: `docs/specs/01-shares-and-pricing.md`; `docs/specs/02-onchain-interface.md`; `programs/basket/src/lib.rs` (`deposit_in_kind`, `shares_for`, `observe_leg`, `redeem`); `tests/program/devnet/seizure.json`, `canonical.json`, `fee-change-mid-position.json`; `web/e2e/holder/runs/2026-09-25-devnet.json` (run started 2026-09-25T10:43:37Z); `tests/program/fork/transcript-final7.json`; `docs/risks.md` §1.

</div>
