# Report (Agent B): Agent A's IDL vs spec 02

Date: 2026-09-25. Compared `programs/basket/idl/basket.json` at branch `program` commit `c141837` with the SDK, which was built from spec 02 (main `7968a9f`), using `sdk/scripts/idl-check.ts`.

**What matches:**
- every spec 02 instruction name and its discriminator;
- account discriminators;
- all ten events;
- error codes 6000–6017;
- the layouts of `Basket`, `Leg`, `LegStatus`, `DepositTicket`, `RedemptionTicket`, `TicketLeg`, `ClaimReason` and `RedeemMode`, field for field. `Basket` adds a trailing `reinvest_mask: u8`, which the SDK's sequential decoder ignores.

## Differences (8)

| # | Instruction | Spec 02 | IDL (`c141837`) |
|---|---|---|---|
| 1 | `initialize_basket` args | `n_legs, mirror_of, max_convert_chunk` | adds `routers: Vec<Pubkey>` (initial allowlist, ≤ 4) |
| 2 | `bootstrap` args | `gross` | adds `initial_shares: u64` (the program comment says clients pass `INITIAL_SHARES`) |
| 3 | `abort_deposit` accounts | owner, basket, ticket, escrow, owner_usdc | adds `token_program, token_2022_program` |
| 4 | `redeem` accounts | …, ticket, usdc_reserve?, token programs, system_program | adds optional `owner_usdc` after `usdc_reserve` |
| 5 | `settle_claim` accounts | cranker, …, owner_token_account, token_2022_program | adds `share_mint` at the end (read for S) |
| 6 | `settle_leg_usdc` accounts | owner, …, owner_usdc, router_program | adds `share_mint` at the end |
| 7 | `remove_router` | not in spec 02 | new authority instruction (spec 02 says removal is immediate but names no instruction) |
| 8 | `open_deposit_ticket` remaining accounts | none listed | the program reads `(mint, vault)×n` as remaining accounts to observe and check availability. Remaining accounts aren't in the IDL; this was found by simulation (`InvalidAccount` 6018 at `leg_slices`). The check is needed for "every leg available", so spec 02 should list them. |

## What the SDK does meanwhile

- All eight differences are additive. So the SDK follows the IDL for them, **explicitly**: each builder carries a comment naming this report.
- The e2e harness can then run against A's committed program.
- If the spec owner decides the other way, the change is confined to `sdk/src/instructions.ts`.
- #3: the SDK had already added `token_program` on its own and flagged it, because the refund needs it.
