---
title: The protocol flow
description: The basket program's accounts, PDA seeds and every instruction, with its accounts in order, its arguments and who may call it.
---

This page is the interface: accounts, seeds and instructions, taken from the program's generated IDL (`programs/basket/idl/basket.json`) and its source. Spec 02 is the agreed design; where the IDL differs from spec 02's first text, spec 02's *Amendments* section records the ruling, and this page follows the IDL.

## Accounts and seeds

| Account | Seeds (PDA of the program) | What it holds |
|---|---|---|
| `Basket` | `["basket", share_mint]` | Authority, share mint, fixture USDC mint and reserve, `n_legs`, up to 8 legs (7 used), the router allowlist (up to 4) and any pending router, `max_convert_chunk`, `deposits_enabled`, `bootstrapped`, `reinvest_mask` |
| `DepositTicket` | `["deposit", basket, owner, nonce (u64 little-endian)]` | The USDC escrow, `usdc_in`, each leg's credited `norm`, `landed_mask`, `created_slot`, `expiry_slot` |
| `RedemptionTicket` | `["redeem", basket, owner, nonce (u64 little-endian)]` | `mode`, `shares_burned`, one `TicketLeg` per leg, `usdc_out` |

Token accounts:

- **Leg vaults:** the associated token account of the basket PDA for each leg mint, under Token-2022. `initialize_basket` creates all of them, so a later change to a mint's default account state can't reach them.
- **USDC reserve:** the basket PDA's associated account for fixture USDC. It's non-zero only during an IPO conversion.
- **Ticket escrow:** the ticket PDA's associated account for fixture USDC.

A `TicketLeg` is `Paid { amount, received }` (gross debited from the vault, and the owner's measured net), `Claim { units, reason }`, or `None`. A claim stores **units, not an amount**, so it shares any later shortfall. Reasons: `Paused`, `Hook`, `Frozen`, `PendingSale`.

## Account-passing rules

- **Per-leg accounts** go in the *remaining accounts*, after every named account, in leg order. Retired legs are skipped.
  - `deposit_in_kind`, `bootstrap` and `redeem` take `(mint, vault, user token account)` per leg.
  - `open_deposit_ticket` and `finalize_deposit` take `(mint, vault)` per leg; `finalize_deposit` then takes any ticket-owned intermediate token accounts to close.
  - `observe` takes `(mint, vault)` for each leg in its bitmask.
  - Router instructions pass the router's own route accounts as remaining accounts.
- **Array arguments** are `Vec`s; the program checks that the length equals `n_legs`.
- **Optional accounts** (`redeem`'s `usdc_reserve` and `owner_usdc`) are Anchor `Option` accounts.
- The program checks every leg's mint and vault against the basket's records (`InvalidAccount` otherwise).

## Instructions

`[w]` writable, `[s]` signer. Every instruction that touches a leg runs `observe` on it first ([seizure handling](/product/how-it-works/#seizure-handling)).

### Setup and authority

<div class="stack ix">

| Instruction | Accounts, in order | Arguments | Who |
|---|---|---|---|
| `initialize_basket` | payer [w, s], authority [s], basket [w], share_mint [w], usdc_mint, usdc_reserve [w], token_program, token_2022_program, associated_token_program, system_program; then `(mint, vault [w])` per leg | `n_legs`, `mirror_of: Vec<Pubkey>`, `max_convert_chunk`, `routers: Vec<Pubkey>` | anyone, once per share mint. Refuses a leg mint without the PreStocks extension set (`UnexpectedExtensionSet`) or with a hook set (`HookNotNull`). |
| `propose_router` | authority [s], basket [w] | `router` | authority. Takes effect after a 48-hour time lock; emits `RouterProposed`. |
| `activate_router` | authority [s], basket [w] | `router` | authority, after the time lock |
| `remove_router` | authority [s], basket [w] | `router` | authority, immediate |
| `set_deposits_enabled` | authority [s], basket [w] | `enabled` | authority. Stops new deposits only. |
| `flag_listing` | authority [s], basket [w] | `leg`, `convert_after`, `deadline` | authority; ≥ 7 days' notice, ≥ 7 days' margin |
| `cancel_listing` | authority [s], basket [w] | `leg` | authority, only before `convert_after` |

</div>

### Deposits

<div class="stack ix">

| Instruction | Accounts, in order | Arguments | Who |
|---|---|---|---|
| `bootstrap` | depositor [s], basket [w], share_mint [w], depositor_share_ata [w], token_program, token_2022_program; then legs | `gross: Vec<u64>` | authority only, once, into an empty basket; mints exactly 1.0 share |
| `deposit_in_kind` | depositor [s], basket [w], share_mint [w], depositor_share_ata [w], token_program, token_2022_program; then legs | `gross: Vec<u64>`, `min_shares` | anyone; every leg available |
| `open_deposit_ticket` | owner [w, s], basket [w], ticket [w], escrow [w], owner_usdc [w], usdc_mint, token_program, associated_token_program, system_program; then `(mint, vault)` per leg | `nonce`, `usdc_in`, `expiry_slots` (1 to 1,500) | anyone; every leg available; deposits enabled |
| `ticket_swap_leg` | owner [s], basket [w], ticket [w], escrow [w], leg_mint, leg_vault [w], router_program; then route accounts | `leg`, `usdc_amount`, `min_out`, `route_data` | the ticket's owner, before expiry; router allowlisted; the ticket PDA signs the router call |
| `finalize_deposit` | owner [w, s], basket [w], ticket [w], escrow [w], owner_usdc [w], share_mint [w], owner_share_ata [w], token_program, token_2022_program; then `(mint, vault)` per leg, then intermediates | `min_shares` | the ticket's owner; every leg landed (`TicketIncomplete` otherwise) |
| `unwind_leg` | owner [s], basket [w], ticket [w], escrow [w], leg_mint, leg_vault [w], router_program; then route accounts | `leg`, `min_usdc_out`, `route_data` | the ticket's owner; the leg must be available; the basket PDA signs the sale |
| `abort_deposit` | owner [w, s], basket, ticket [w], escrow [w], owner_usdc [w], token_program, token_2022_program; then intermediates | — | the ticket's owner, once no leg is still landed (`LegsStillLanded` otherwise) |

</div>

### Redemptions and claims

<div class="stack ix">

| Instruction | Accounts, in order | Arguments | Who |
|---|---|---|---|
| `redeem` | owner [w, s], basket [w], share_mint [w], owner_share_ata [w], ticket [w], usdc_reserve [w, optional], owner_usdc [w, optional], token_program, token_2022_program, system_program; then legs | `nonce`, `shares`, `mode` (`InKind` or `Usdc { min_usdc_out }`) | any share holder. Never fails because a leg is unavailable. |
| `settle_claim` | cranker [s], basket [w], ticket [w], leg_mint, leg_vault [w], owner_token_account [w], token_2022_program, share_mint | `leg` | **anyone** for `Paused`, `Hook` and `Frozen` claims; only the owner for `PendingSale` |
| `settle_leg_usdc` | owner [s], basket [w], ticket [w], leg_mint, leg_vault [w], owner_usdc [w], router_program, share_mint; then route accounts | `leg`, `min_usdc_out`, `route_data` | the ticket's owner; router allowlisted |
| `close_redemption` | owner [w, s], ticket [w] | — | the ticket's owner, once no claim remains (`OutstandingClaims` otherwise) |

</div>

### Maintenance (permissionless)

<div class="stack ix">

| Instruction | Accounts, in order | Arguments | Who |
|---|---|---|---|
| `observe` | cranker [s], basket [w]; then `(mint, vault)` per leg in the mask | `legs` (bitmask) | anyone. Records a shortfall or surplus without waiting for a user action |
| `harvest` | cranker [s], basket, leg_mint [w], leg_vault [w], token_2022_program | `leg` | anyone. Moves the vault's withheld transfer fees to the mint (`harvest_withheld_tokens_to_mint`) |
| `convert_listed_leg` | cranker [s], basket [w], leg_mint, leg_vault [w], usdc_mint, usdc_reserve [w], router_program; then route accounts | `leg`, `amount` (≤ `max_convert_chunk`), `min_usdc_out`, `route_data` | anyone. IPO rule step 3, after `convert_after`, with no open claims on the leg |
| `reinvest_reserve` | cranker [s], basket [w], usdc_mint, usdc_reserve [w], leg_mint, leg_vault [w], router_program; then route accounts | `leg`, `usdc_amount` (must equal the leg's equal slice), `min_out`, `route_data` | anyone. IPO rule step 4 |

</div>

## Routers: trusted for nothing

The program calls whatever program is in its **router allowlist**, passing opaque instruction data and the route's accounts. On devnet the allowlist holds `fixture_amm` (`aznyZehUyR37Zr9iRM22jgWoPQ43PznYB9TDUxYMTqF`), the project's own constant-product pools. In the mainnet-fork tests it held Jupiter v6. The same program binary is used in both.

It trusts nothing the router reports:

- every swap is judged by the **measured** change in the destination account, against the caller's minimum (`SlippageExceeded`);
- the source may not lose more than the stated amount (`RouteViolation`).

When the **basket PDA** signs the router call (`unwind_leg`, `settle_leg_usdc`, `convert_listed_leg`, `reinvest_reserve`), the program also checks, after the call:

- every other basket-owned token account that appears in the route kept its balance, is still the basket's, and has no delegate or close authority (`RouteViolation`);
- the vault it sold from is still the basket's, with no delegate or close authority;
- the share mint didn't appear in the route at all.

In `ticket_swap_leg` the ticket PDA signs instead, so the basket's own accounts can't be debited by that call.

For live Jupiter routes, spec 02 requires excluding Manifest (its quotes ignore the transfer fee) and 1DEX (it rejects a program-owned taker).

## Transaction sizes

- **In kind** (deposit or redemption): about 27 accounts (seven legs × 3, plus the basket, the share mint, the user's share account, the user and two token programs), in one transaction.
- **USDC ticket on a mainnet fork, with live Jupiter routes** (`tests/program/fork/transcript-final7.json`): 4 transactions, each landing first try.

  | Transaction | Accounts | Bytes | Compute units |
  |---|---|---|---|
  | open + OPENAI (2-hop) | 50 | 1,064 | 306k |
  | ANTHROPIC + NEURALINK + ANDURIL | 46 | 1,159 | 423k |
  | POLYMARKET + KALSHI (2-hop) | 45 | 1,124 | 361k |
  | FIGUREAI + finalize, closing 8 intermediates | 48 | 1,015 | 243k |

  The byte limit binds before the 64-account lock limit: at most 3 legs fit in a transaction, and 2 when one is 2-hop or shares the transaction with `open`. Every leg's call depth is 4 (basket → Jupiter → AMM → Token-2022), the current limit.
- **USDC ticket on devnet**, through `fixture_amm`: 2 transactions in the browser run ([The user flow](/product/user-flow/#1-buy-in)).

<div class="sources">

Sources: `programs/basket/idl/basket.json`; `programs/basket/src/lib.rs`, `state.rs`; `docs/specs/02-onchain-interface.md` (*Accounts*, *Instructions*, *Amendments*, *Router route rules*, *Budgets*); `tests/program/fork/transcript-final7.json`.

</div>
