# Spec 02: On-chain interface

Status: **agreed** (2026-09-25); agents A, B and C built against it. The product is **Unlisted**; `basket` remains the technical identifier for the program, its accounts, seeds and instructions (see the naming note in [spec 00](00-agent-split.md)). Agent A implements this. Agents B and C build against this document before A's generated IDL exists.

When A's generated Anchor IDL differs from this document in any name, type, account order or seed, A reports the difference and the spec owner decides which side changes. Neither side silently adapts.

Share maths is in spec 01 and the reference model; this spec does not repeat it.

## Programs

| Program | Owner | Purpose | Cluster |
|---|---|---|---|
| `basket` | Agent A (`programs/basket/`) | Vault, shares, deposit and redemption tickets, claims, IPO rule | devnet; tests on a cloned-mainnet fork |
| `fixture_amm` | Agent C (`fixtures/amm/`) | Constant-product pools for fixture USDC against each fixture leg, used as the devnet **router**. Seeded to mirror mainnet prices. | devnet |

**The router is not hard-coded.**
- `basket` CPIs whatever program is in its **router allowlist**, passing opaque instruction data plus the remaining accounts.
- It trusts nothing the router reports. Every swap is judged by the **measured** change in the destination account, checked against the caller's `min_out`.
- On devnet the allowlist holds `fixture_amm`. In cloned-mainnet tests it holds Jupiter v6 (`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`), with routes from `api.jup.ag/swap/v2/build` using `maxAccounts≈30` and the vault or ticket PDA as `taker`.
- The same program binary is used in both.

## Constants

| Name | Value |
|---|---|
| `MAX_LEGS` | 8 (v1 uses 7) |
| `SHARE_DECIMALS` | 9 |
| `INITIAL_SHARES` | 1_000_000_000 |
| `INDEX_ONE` | 10^18 |
| `MIN_LISTING_NOTICE` | 7 days |
| `MIN_DEADLINE_MARGIN` | 7 days |
| `ROUTER_ALLOWLIST_MAX` | 4 |
| `ALLOWLIST_TIMELOCK` | 48 h |
| `TICKET_MAX_AGE_SLOTS` | 1_500 (≈ 6.6 min at the measured 0.2657 s/slot) |

## Accounts

### `Basket`: PDA `["basket", share_mint]`

```rust
pub struct Basket {
    pub version: u8,
    pub bump: u8,
    pub authority: Pubkey,            // limited powers, see "Authority"
    pub share_mint: Pubkey,           // classic SPL Token mint, decimals 9, mint authority = this PDA
    pub usdc_mint: Pubkey,            // fixture USDC on devnet
    pub usdc_reserve: Pubkey,         // ATA(basket, usdc_mint); non-zero only during IPO conversion
    pub accounted_usdc_reserve: u64,
    pub n_legs: u8,
    pub legs: [Leg; MAX_LEGS],
    pub router_allowlist: [Pubkey; ROUTER_ALLOWLIST_MAX],
    pub pending_router: Option<(Pubkey, i64 /* effective_ts */)>,
    pub max_convert_chunk: u64,       // raw units per convert_listed_leg call
    pub deposits_enabled: bool,       // authority can stop new deposits; never redemptions
    pub bootstrapped: bool,
}

pub struct Leg {
    pub mint: Pubkey,                 // Token-2022 fixture mint
    pub vault: Pubkey,                // ATA(basket, mint, token_2022); created at init, never re-created
    pub accounted: u64,               // A_i
    pub claim_units: u64,             // C_i
    pub pending_norm: u128,           // P_i
    pub loss_index: u128,             // L_i, starts at INDEX_ONE
    pub status: LegStatus,            // Active | Listing { convert_after: i64, deadline: i64 } | Retired
    pub mirror_of: Pubkey,            // the mainnet PreStocks mint this fixture mirrors (display only)
}
```

`B_i` (the actual balance) is **never stored**. It is read from `leg.vault` every time.

### `DepositTicket`: PDA `["deposit", basket, owner, nonce: u64 le]`

```rust
pub struct DepositTicket {
    pub basket: Pubkey, pub owner: Pubkey, pub nonce: u64, pub bump: u8,
    pub escrow: Pubkey,               // ATA(ticket, usdc_mint)
    pub usdc_in: u64,
    pub norm: [u128; MAX_LEGS],       // per-leg normalised deltas (0 = not landed)
    pub landed_mask: u8,
    pub created_slot: u64,
    pub expiry_slot: u64,
}
```

### `RedemptionTicket`: PDA `["redeem", basket, owner, nonce: u64 le]`

```rust
pub struct RedemptionTicket {
    pub basket: Pubkey, pub owner: Pubkey, pub nonce: u64, pub bump: u8,
    pub mode: RedeemMode,             // InKind | Usdc { min_usdc_out: u64 }
    pub shares_burned: u64,
    pub legs: [TicketLeg; MAX_LEGS],
    pub usdc_out: u64,                // accumulated in Usdc mode, paid on close
}
pub enum TicketLeg {
    Paid { amount: u64, received: u64 },           // amount = gross debited from the vault; received = owner's measured net
    Claim { units: u64, reason: ClaimReason },     // C_i units; the amount is fixed only at settlement
    None,
}
pub enum ClaimReason { Paused, Hook, Frozen, PendingSale }
```

A `Claim` stores **units, not an amount**, so it shares any later shortfall pro rata (spec 01).

**USDC-mode redemption uses the same mechanism.** Every leg becomes `Claim { reason: PendingSale }` and is settled by a sale. There is no separate "owed amount" state, so nothing escapes the pro-rata rule. **A sale that can't route falls back to in-kind settlement** (`settle_claim`), so a claim never gets stuck behind a missing route.

## Availability check: run for every leg an instruction touches

```text
available(i) =  !mint.PausableConfig.paused
             && mint.TransferHook.program_id == None
             && leg.vault.state == Initialized
```

This reads the mint's extension data directly. It does not depend on client-supplied flags.

## Instructions

Every instruction that touches leg `i` runs `observe(i)` first (spec 01). Accounts are listed in order. `[w]` = writable, `[s]` = signer.

**Encoding rules** (settled 2026-09-25 after Agent B's report `docs/reports/2026-09-25-app-ticket-packing.md` on branch `app`):
- `legs*` means the per-leg accounts for every active leg, passed as **remaining accounts after all named accounts, including the token programs**. The order is `(mint, vault, user_token_account)` per leg, in leg order.
- Array arguments written `[T; n]` are encoded as **`Vec<T>`**. The program checks `len == n_legs` and fails with `MathOverflow` otherwise.
- **Optional accounts** (e.g. `redeem`'s `usdc_reserve`) are Anchor `Option<Account>`.

### Setup and authority

| Instruction | Accounts | Args | Rules |
|---|---|---|---|
| `initialize_basket` | payer[w,s], authority[s], basket[w], share_mint[w], usdc_mint, usdc_reserve[w], `(mint, vault[w])×n`, token_program, token_2022_program, associated_token_program, system_program | `n_legs, mirror_of: [Pubkey; n], max_convert_chunk` | Creates every vault account now: default-state changes after init can't reach them. Refuses any leg mint that lacks the expected extension set or has a non-null hook at init. |
| `propose_router` / `activate_router` | authority[s], basket[w] | `router: Pubkey` | Adding a router takes effect after `ALLOWLIST_TIMELOCK`; removal is immediate. |
| `set_deposits_enabled` | authority[s], basket[w] | `bool` | Stops new deposits only. **There is no authority path that moves vault tokens or blocks redemption.** |
| `flag_listing` | authority[s], basket[w] | `leg, convert_after, deadline` | `convert_after ≥ now + MIN_LISTING_NOTICE` and `deadline − convert_after ≥ MIN_DEADLINE_MARGIN`. Emits `LegListing`. |
| `cancel_listing` | authority[s], basket[w] | `leg` | Only before `convert_after`. |

### Mint

| Instruction | Accounts | Args | Rules |
|---|---|---|---|
| `bootstrap` | depositor[s], basket[w], share_mint[w], depositor_share_ata[w], `legs*`, token programs | `gross: [u64; n]` | Only once, into an empty basket. Mints `INITIAL_SHARES`. |
| `deposit_in_kind` | depositor[s], basket[w], share_mint[w], depositor_share_ata[w], `legs*`, token programs | `gross: [u64; n], min_shares` | Every leg available. Uses `transfer_checked` from the depositor into each vault and measures each delta. Mint formula from spec 01. |
| `open_deposit_ticket` | owner[s], basket, ticket[w], escrow[w], owner_usdc[w], usdc_mint, token_program, associated_token_program, system_program, then remaining: `(mint, vault)×n` | `nonce, usdc_in, expiry_slots ≤ TICKET_MAX_AGE_SLOTS` | Every leg available; deposits enabled. |
| `ticket_swap_leg` | owner[s], basket[w], ticket[w], escrow[w], leg mint, leg vault[w], router_program, + route accounts | `leg, usdc_amount, min_out, route_data: Vec<u8>` | Router in allowlist. The ticket PDA signs the router CPI as taker. Measures the vault delta, requires `≥ min_out`, credits norm. 2–3 legs per transaction (see *Budgets*). **Intermediate accounts:** routes should use the router's shared intermediate accounts (Jupiter `useSharedAccounts=true`), so none is owned by the ticket PDA. If a route needs a ticket-owned intermediate token account, the owner pays to create it, and `finalize_deposit` / `abort_deposit` close every ticket-owned token account passed as remaining accounts (the ticket PDA signs), refunding the rent to the owner. `onlyDirectRoutes` is not used: it costs price. |
| `finalize_deposit` | owner[s], basket[w], ticket[w], escrow[w], owner_usdc[w], share_mint[w], owner_share_ata[w], token_program, token_2022_program, then remaining: `(mint, vault)×n`, then any ticket-owned intermediate token accounts | `min_shares` | All legs landed. Mints shares, refunds leftover USDC, closes intermediate accounts and the ticket (rent to owner). |
| `unwind_leg` | owner[s], basket[w], ticket[w], escrow[w], leg mint, leg vault[w], router_program, + route accounts | `leg, min_usdc_out, route_data` | After expiry, or at the owner's request before finalize: sells the ticket's landed amount of the leg back into the escrow. |
| `abort_deposit` | owner[s], basket, ticket[w], escrow[w], owner_usdc[w] | — | Every landed leg is unwound. Refunds the escrow and closes the ticket. |

### Redeem

| Instruction | Accounts | Args | Rules |
|---|---|---|---|
| `redeem` | owner[s], basket[w], share_mint[w], owner_share_ata[w], ticket[w], `legs*` (owner token accounts required for in-kind), usdc_reserve[w] if converting, token programs, system_program | `nonce, shares, mode` | Burns shares. InKind: each available leg is paid in kind now. Usdc: each available leg becomes `Claim { PendingSale }`. **Each unavailable leg becomes `Claim { units: shares, reason }`, `C_i += shares`, and emits `ClaimCreated`.** Never fails because a leg is unavailable. Pays its pro-rata USDC reserve share if any. |
| `settle_claim` | cranker[s], basket[w], ticket[w], leg mint, leg vault[w], owner_token_account[w], token_2022_program | `leg` | Permissionless for `Paused`/`Hook`/`Frozen` claims once the leg is available. For `PendingSale`, only the owner, and only as the fallback when no route works. Pays `floor(units × owned_i / (S + C_i))` in kind; `C_i −= units`. Emits `ClaimSettled`. |
| `settle_leg_usdc` | owner[s], basket[w], ticket[w], leg mint, leg vault[w], owner_usdc[w], router_program, + route accounts | `leg, min_usdc_out, route_data` | Settles a `PendingSale` claim, or any claim once its leg is available. Sells `floor(units × owned_i / (S + C_i))` from the vault; the basket PDA signs the router CPI as taker. Measures the owner's USDC delta against `min_usdc_out`. `C_i −= units`. |
| `close_redemption` | owner[s], ticket[w] | — | Only when no `Claim` legs remain. |

### Maintenance (all permissionless)

| Instruction | Accounts | Args | Purpose |
|---|---|---|---|
| `observe` | cranker[s], basket[w], then remaining: `(mint, vault)` for each leg in the mask, in leg order | `legs: u8 mask` | Runs `observe` on the listed legs so a shortfall is emitted without waiting for a user action. The UI and the watcher call it. |
| `harvest` | cranker[s], basket, leg mint[w], leg vault[w], token_2022_program | `leg` | CPIs `harvest_withheld_tokens_to_mint` for the leg's vault. |
| `convert_listed_leg` | cranker[s], basket[w], leg mint, leg vault[w], usdc_mint, usdc_reserve[w], router_program, + route accounts | `leg, amount ≤ max_convert_chunk, min_usdc_out, route_data` | After `convert_after`, once `C_i == 0`. The basket PDA signs the router CPI and sells into `usdc_reserve`. Marks the leg `Retired` when `owned_i == 0`. |
| `reinvest_reserve` | cranker[s], basket[w], usdc_mint, usdc_reserve[w], leg mint, leg vault[w], router_program, + route accounts | `leg, usdc_amount, min_out, route_data` | Buys remaining legs in equal USDC slices (`reserve_at_retirement / active_legs`). The basket PDA signs. Output measured into each vault. |

## Amendments from the IDL review (2026-09-25)

Agent B diffed Agent A's IDL (`program@c141837`) against this spec (`docs/reports/2026-09-25-app-idl-diff.md` on `app`). The spec owner's rulings:

| # | Difference | Ruling |
|---|---|---|
| 1 | `initialize_basket` takes `routers: Vec<Pubkey>` | **Ratified.** This is the initial allowlist; the 48 h timelock applies to later additions. |
| 2 | `bootstrap` takes `initial_shares: u64` | **Reversed.** Remove the arg; bootstrap always mints `INITIAL_SHARES` (spec 01). |
| 3 | `abort_deposit` adds `token_program`, `token_2022_program` | **Ratified.** |
| 4 | `redeem` adds optional `owner_usdc` after `usdc_reserve` | **Ratified.** Pays the pro-rata USDC reserve during an IPO conversion. |
| 5, 6 | `settle_claim`, `settle_leg_usdc` add `share_mint` (last) | **Ratified.** `S` is the share mint's supply and isn't stored. |
| 7 | New instruction `remove_router` | **Ratified.** Authority only, immediate (see *Authority*). |
| 8 | `open_deposit_ticket` reads `(mint, vault)×n` as remaining accounts | **Ratified**, and now part of this spec: it is needed for the availability check. |
| — | Meaning of `amount` in `ClaimSettled` / `TicketLeg::Paid` | **`amount` is the gross debited from the vault** (the model's `floor(...)`, reconcilable with `A_i`). A new field **`received`** is the owner's measured net of the transfer fee. |

### Router route rules (from A's fork findings, 2026-09-25)

- **`excludeDexes=Manifest,1DEX`** for every route the program executes, and for every `sell_now` quote in spec 03, so quoted routes stay executable.
  - Manifest: its quotes ignore the transfer fee.
  - 1DEX: it requires a system-owned taker, so it can't route with a PDA.
  - Hadron, Flux, BisonFi and TesseraV also failed on the fork. That looks like stale prop-AMM state on the fork, not a real limit; re-check on devnet or a fresh fork before excluding them.
- A route may list a basket-owned token account other than the destination (e.g. `route_v2` lists the basket's USDC ATA, which is `usdc_reserve`, at index 2 in basket-signed sells). **The program requires every basket-owned token account in the route, other than the intended source and destination, to be unchanged after the CPI.**

### Further IDL differences, ratified

- `ClaimCreated.reason` uses `ClaimReason`.
- `pending_router` is a struct with the same bytes as the specified tuple.
- Errors 6018–6024 are added. A lists them in its report; this spec will copy them when it lands.
- `bootstrap` is **authority-only**. That is stricter than the spec, and accepted.
- `Basket.reinvest_mask` (additive state field; it tracks which legs have taken their equal reinvest slice after a conversion). Ratified 2026-09-25 from A's final report.

### Known limitation: a ticket-owned account left out of `abort_deposit` / `finalize_deposit` (2026-09-25)

**Found by** Agent A's broken version (b) on devnet: an abort that omits a ticket-owned intermediate token account is **accepted** by the program. The intermediate survives, holding the owner's rent (≈ 0.0016 SOL). Once the ticket is closed, nothing can close it.

**Why the program can't refuse it:** it can't enumerate the token accounts a PDA owns, and intermediates are created by the client, not the program.

**Mitigations now:**
- The SDK always passes every ticket-owned account it created.
- A's devnet check and B's e2e both assert `getTokenAccountsByOwner(ticket)` is empty on both token programs after finalize or abort. Each has a recorded failing version.

**Scheduled after the hackathon:** a permissionless `sweep_ticket_account(owner, nonce, token_account)` that re-derives the closed ticket PDA from its seeds and closes a stranded account, with rent to the owner.

**Scope:** only rent, only the owner's, and only through a client that omits accounts. No user funds are at risk.

## Events

```rust
ShortfallObserved { leg: u8, expected: u64, actual: u64, loss_index: u128, slot: u64 }
SurplusObserved   { leg: u8, expected: u64, actual: u64, slot: u64 }
Minted            { owner: Pubkey, shares: u64, deltas: [u64; MAX_LEGS], path: MintPath /* InKind | Ticket | Bootstrap */ }
Redeemed          { owner: Pubkey, ticket: Pubkey, shares: u64, paid: [u64; MAX_LEGS], claims_mask: u8 }
ClaimCreated      { owner: Pubkey, ticket: Pubkey, leg: u8, units: u64, reason: Unavailable /* Paused | Hook | Frozen */ }
ClaimSettled      { owner: Pubkey, ticket: Pubkey, leg: u8, units: u64, amount: u64 /* gross from vault */, received: u64 /* owner's measured net */ }
LegListing        { leg: u8, convert_after: i64, deadline: i64 }
LegConverted      { leg: u8, amount: u64, usdc: u64 }
LegRetired        { leg: u8 }
RouterProposed    { router: Pubkey, effective_ts: i64 }
```

## Errors

```text
6000 LegUnavailable        6001 SlippageExceeded       6002 InsufficientShares
6003 TicketIncomplete      6004 TicketExpired          6005 RouterNotAllowed
6006 NotBootstrapped       6007 AlreadyBootstrapped    6008 LegEmpty
6009 ListingNoticeTooShort 6010 ConversionNotOpen      6011 OutstandingClaims
6012 DepositsDisabled      6013 UnexpectedExtensionSet 6014 HookNotNull
6015 VaultFrozen           6016 MathOverflow           6017 ChunkTooLarge
6018 InvalidAccount        6019 Unauthorized           6020 NoClaim
6021 RouteViolation        6022 LegsStillLanded        6023 RouterNotPending
6024 InvalidArgument
```

Errors 6018–6024 were added by Agent A and ratified on 2026-09-25 (`docs/reports/2026-09-25-program-idl-and-fork.md` §2 on `program`).

## Budgets (from Phase 0 measurements, to be re-proven by A)

- **In-kind deposit or redeem:** about 27 accounts (7 × 3 per-leg accounts, plus basket, share mint, user share account, user, and two token programs), under the 64-lock limit, in one transaction.
- **`ticket_swap_leg`:** 17–29 route accounts at `maxAccounts=30`, plus about 8 program accounts.
  - **Measured by Agent B on 2026-09-25** (live Jupiter v2 routes, all 7 legs, with a basket lookup table, nothing signed): the 64-account-lock limit binds.
    - At `maxAccounts=30`: **3 transactions per deposit**: [open + 2 legs] 51 accounts, [3 legs] 43, [2 legs + finalize] 49.
    - At `maxAccounts=20`: still 3.
  - **Follow-up (Agent B, commit 754be17 on `app`):** v2 `/build` accepts `useSharedAccounts=true` but ignores it: it always returns `route_v2`, never `shared_accounts_route_v2`. Ticket-owned intermediate accounts are therefore needed (1 per single-hop leg, 2 per multi-hop leg). Closing them in `finalize_deposit` makes it **4 transactions** (1,051 / 1,169 / 930 / 738 bytes; 48 / 53 / 36 / 35 accounts).
  - **Plan for 4 transactions per deposit under one wallet approval.**
  - **Resolved by A on the fork (commit 700004c):** `route_v2` **does** need the taker's own output account to exist even when `destinationTokenAccount` is set. Without it Jupiter fails with `0x1789` (6025 InvalidTokenAccount), reproduced on 2 legs. The SDK keeps creating it, and `finalize_deposit` / `abort_deposit` close it.
  - **Final, proven by A on the cloned-mainnet fork (commit 27e0ea9, `tests/program/fork/transcript-final7.json`):** a full USDC deposit with the real program, real PreStocks mints and live Jupiter routes is **4 transactions**, all landing first try:

    | Transaction | Accounts | Bytes | CU |
    |---|---|---|---|
    | open + OPENAI (2-hop) | 50 | 1,064 | 306k |
    | ANTHROPIC + NEURALINK + ANDURIL | 46 | 1,159 | 423k |
    | POLYMARKET + KALSHI (2-hop) | 45 | 1,124 | 361k |
    | FIGUREAI + finalize, closing 8 intermediates | 48 | 1,015 | 243k |

  - **The byte limit binds before the 64 locks.** At most 3 legs fit per transaction, and 2 when one is 2-hop or shares the transaction with `open`. Clients pack by serialized size.
  - **Prop AMMs: settled on real mainnet state** by A (commit 90c5ff3, `tests/program/fork/mainnet-prop-amm-sim.json`; `simulateTransaction` with `sigVerify:false`, slots 450,141,263–450,141,456). Three takers were tried: a system wallet, an empty PDA, and a program-owned data account.
    - **BisonFi, Flux, Quantum, TesseraV and Hadron accept all three.** Their fork failures were artifacts, and they stay allowed.
    - **1DEX rejects the program-owned taker** (`OwnerSystemProgramID`, 26000), and stays excluded.
  - **CPI depth is 4 on every leg** (basket → Jupiter → AMM → Token-2022), including 2-hop routes. Proven on the fork.
- **CPI depth:** basket → router → AMM → Token-2022 is 4 levels, exactly the current limit (`raise_cpi_nesting_limit_to_8` is not active). A must prove this with Jupiter on the cloned-mainnet fork and report any route that exceeds it.

## Authority: what it can and can't do

| It can | It can't |
|---|---|
| Propose routers (48 h timelock) | Move vault tokens |
| Stop new deposits | Stop, delay or alter redemptions and claims |
| Flag a listing (≥ 7 d notice) | Change shares, claims or loss indices |

Program upgrade authority is held by the deployer on devnet and disclosed in the UI.

## Fixtures (first-class; owned by Agent C)

- **Seven fixture mints**, one per constituent. Each has:
  - Token-2022, 9 decimals, `TransferFeeConfig` mirroring the mainnet mint's **current** schedule at creation (as of 2026-09-25: 100 bps, rising to 300 bps at epoch 1043), with `maximumFee = u64::MAX`;
  - `PermanentDelegate`, `PausableConfig`, `DefaultAccountState(initialized)`, `ScaledUiAmountConfig` mirroring the mainnet multiplier (OpenAI 1.4861347, others 1);
  - `TransferHook` with a null program and a live authority, `ConfidentialTransferMint` and `ConfidentialTransferFeeConfig`, `MetadataPointer` and `TokenMetadata`.
  - Fixture authorities are held by a fixture-issuer key (a devnet stand-in for the 2-of-7 multisig).
  - Plus **fixture USDC** (classic SPL, 6 decimals).
- **Documented diff.** For each fixture, `fixtures/DIFF.md` compares the extension set and every field against the mainnet mint at a stated slot. Phase 0 showed the extension-set diff is empty; the field diff (authorities, supply, metadata strings) must be listed, not implied.
- **Issuer scenario suite.** Each scenario runs as real devnet transactions and records every signature in `fixtures/scenarios/<name>.json`:

  | Scenario | What it proves |
  |---|---|
  | `seizure` | The fixture issuer burns from a basket vault. `observe` emits `ShortfallObserved`. A redemption receives pro-rata less. A later depositor pays the reduced rate. |
  | `pause-mid-redemption` | **Most coverage.** Pause between redemption and payout: available legs paid, claim created. Settlement fails while paused and succeeds after resume. Also covers several legs paused, and a seizure while a claim is open. |
  | `fee-change-mid-position` | Reproduces the real change PreStocks made on 2026-09-24: `set-transfer-fee` 100 → 300 bps with a position open, wait two epochs (about 64 h), then redeem. The recipient's net reflects the new fee, a ticket straddling the change still finalises, and no fee is stored anywhere. |
  | `multiplier-change-mid-position` | `update-ui-amount-multiplier` with a near-future timestamp: raw balances and shares unchanged; the API's display value changes only after the effective time. |
  | `hook-switched-on` | Attach a hook program: deposits refused with `LegUnavailable`, redemptions turn the leg into a claim. |
  | `frozen-vault` | Freeze one basket vault account: same partial-redemption behaviour. |
