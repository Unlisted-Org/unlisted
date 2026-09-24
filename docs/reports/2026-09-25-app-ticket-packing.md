# Report (Agent B): deposit-ticket packing — 4 legs per transaction does not fit

Date: 2026-09-25. Raised with the spec owner; affects spec 02 *Budgets* (A proves the real count) and the app's approval flow.

## What was measured

`sdk/scripts/measure-packing.ts` fetched **live mainnet Jupiter routes** (`api.jup.ag/swap/v2/build`, `excludeDexes=Manifest`, $10 per leg, `taker` = a deposit-ticket PDA, `destinationTokenAccount` = the leg vault) for all seven legs, wrapped each in the SDK's `ticket_swap_leg` instruction (spec 02 account list), and packed them greedily with `open_deposit_ticket` and `finalize_deposit` into v0 transactions. **Nothing was signed or sent.** A throwaway program id stands in for `basket` (changes PDAs, not sizes). Raw output: `2026-09-25-app-packing-maxaccounts30.json` (2026-09-24T19:16:23Z) and `…-maxaccounts20.json` (19:17:06Z).

| Packing | `maxAccounts=30` | `maxAccounts=20` |
|---|---|---|
| Route lookup tables only | 4 transactions: [open+1 leg], [3], [3], [finalize] | 3: [open+3], [3], [1+finalize] |
| Plus a basket lookup table (programs, basket, share mint, USDC, 7 mints, 7 vaults, router) | **3 transactions: [open+2 legs] 1,119 B / 51 accounts, [3 legs] 1,004 B / 43, [2 legs + finalize] 1,002 B / 49** | 3: [open+3] 1,080 B / 51, [3] 1,064 B / 42, [1+finalize] 754 B / 40 |

- **The binding limit is the 64 account locks**, not bytes, once a basket lookup table is used. Each leg's route brings ~14 accounts of its own (pool, bins/ticks, oracle); a 4th leg takes a transaction past 64.
- Spec 02 plans "4 legs per transaction and 2 transactions per deposit". Measured: **3 legs per transaction at most, 3 transactions per deposit.** One wallet approval still covers all of them (the SDK hands every transaction to the wallet in one `signTransaction`/`signAllTransactions` call).
- Jupiter's per-leg route account count is 27–31 even at `maxAccounts=20` (its count differs from the instruction's account list).

## Two further findings

1. **`destinationTokenAccount` works with a PDA taker.** Setting it to the vault replaces the output slot in the swap instruction (recorded in `sdk/test/fixtures/jupiter-build-usdc-anthropic.json`). So "output straight into the vault" (spec 01) is available from `/build` without a custom route.
2. **Multi-hop routes need an intermediate token account owned by the ticket PDA.** At 19:16Z OPENAI routed `Whirlpool → Meteora DLMM` (USDC → SOL → OPENAI). `/build` returns a setup instruction creating the PDA's intermediate ATA (payer = the PDA, which can't sign at top level) and a cleanup that closes it (needs the PDA's signature).
   - The SDK re-issues the create with the **user as payer** and drops the close. The intermediate account is then left open, owned by the ticket PDA: the user loses its rent (~0.002 SOL) unless `basket` closes it.
   - Options for A / spec owner: (a) `ticket_swap_leg` / `finalize_deposit` closes PDA-owned intermediate accounts back to the owner; (b) the client uses `onlyDirectRoutes=true` (price cost not measured); (c) accept and disclose. **The SDK does (c) for now and lists the accounts in `SwapRoute.leftOpenAccounts`.**
   - The CPI depth for this route is still basket → Jupiter → AMM → Token-2022 = 4 (A to prove on the fork).

## Spec 02 ambiguities the SDK had to resolve (to be checked against A's IDL)

Listed in `sdk/src/instructions.ts` `INTERFACE_ASSUMPTIONS`:
- `[T; n]` args (`gross`, `mirror_of`) encoded as Borsh `Vec<T>`.
- `legs*` are remaining accounts, so they go **after** every named account; spec 02's tables list token programs after `legs*` for `deposit_in_kind`, `bootstrap` and `redeem`, which Anchor can't express.
- `redeem`'s `usdc_reserve[w] if converting` treated as an Anchor optional account (program id as the "None" placeholder).
- Maintenance instructions (`observe`, `harvest`, `convert_listed_leg`, `reinvest_reserve`) have args but no account lists in spec 02; the SDK's lists are guesses until the IDL.

The SDK will be checked against `programs/basket/idl/basket.json` with `sdk/scripts/idl-check.ts` once A publishes it; differences will be reported, not adapted.

---

## Follow-up after the spec owner's decision (spec 02 at main `7968a9f`)

### `useSharedAccounts=true` on Jupiter v2 `/build`: accepted, ignored

Requests at 2026-09-24 ~19:20Z (taker = off-curve PDA, `destinationTokenAccount` set, `maxAccounts=30`, `excludeDexes=Manifest`), for OPENAI (multi-hop, Whirlpool → Meteora DLMM) and ANDURIL (single hop), each with `useSharedAccounts=true` and `false`:
- All four return HTTP 200 with the **same** swap instruction: discriminator `bb64facc31c4af14` = `route_v2`. `shared_accounts_route_v2` would be `d19853937cfed8e9`.
- The setup (ATA creations with the PDA as payer) and cleanup (`CloseAccount` of the intermediate wSOL account) are identical with and without the flag.
- Recorded: `sdk/test/fixtures/jupiter-build-usdc-openai-multihop-useSharedAccounts.json`.

So v2 `/build` gives no shared-accounts route; ticket-owned token accounts are still needed. The SDK still sends `useSharedAccounts=true`, in case Jupiter starts honouring it.

### `route_v2` also lists the taker's own output account

Even with `destinationTokenAccount` = the vault, `route_v2` keeps `user_destination_token_account` (the ticket PDA's ATA for the leg mint) at account index 2, and `/build` returns a setup instruction that creates it.
- It is **not verified** whether `route_v2` requires that account to exist when a destination override is given. A can settle this on the fork.
- Until then the SDK takes the safe path, per spec 02:
  - the owner pays to create every ticket-owned token account the swap references (all except the source escrow);
  - the SDK passes them to `finalize_deposit` / `abort_deposit` as remaining accounts after `(mint, vault)×n`, for the program to close with rent back to the owner.
- That is one account per single-hop leg and two per multi-hop leg: 9 at the measured moment.

### Packing with those accounts closed in `finalize_deposit`

Measured 2026-09-24T19:21:57Z (`2026-09-25-app-packing-maxaccounts30-with-intermediates.json`), `maxAccounts=30`, with a basket lookup table:

| Tx | Contents | Bytes | Accounts |
|---|---|---|---|
| 1 | open + 2 legs | 1,051 | 48 |
| 2 | 3 legs | 1,169 | 53 |
| 3 | 2 legs | 930 | 36 |
| 4 | finalize, closing 9 intermediates | 738 | 35 |

- **4 transactions**, still one wallet approval.
- Finalize no longer fits alongside the last 2 legs, because the 9 intermediates are per-ticket addresses that can't be in the shared lookup table.
- If A shows on the fork that `route_v2` doesn't need the output ATA when a destination is given, the SDK stops creating it. That leaves only the multi-hop intermediates, which likely brings this back to 3 transactions.
