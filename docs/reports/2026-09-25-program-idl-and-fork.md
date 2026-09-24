# Report (Agent A): basket program — IDL vs spec 02, fork proof, open items

Date: 2026-09-25. Branch `program`. For the spec owner and Agents B and C.

## 1. Rulings applied

At commit `700004c`:
- `bootstrap(gross)` always mints `INITIAL_SHARES`.
- `TicketLeg::Paid` is `{ amount, received }`, and `ClaimSettled` gains `received`.
  - `amount` is the gross debited from the vault (the model's floor value).
  - `received` is the owner's measured net.
  - For `settle_leg_usdc`, `received` is the USDC measured and `amount` is the leg units sold.

**Consequence for the model port.** Four model tests bootstrap with 3 or 10^12 shares, which the program can't reproduce:
- `test_redeem_pays_floor`
- `test_open_ticket_bears_shortfall_pro_rata`
- `test_claim_shares_a_later_seizure_pro_rata`
- `test_redeem_during_conversion_gets_pro_rata_usdc`

They are replayed through INITIAL_SHARES variants (`tests/program/vectors/variants_initial_shares.py`):
- the same assertions;
- share counts scaled;
- the floor test uses a fractional per-share amount, so floor and ceil still differ.

The test first asserts that the original passes in the model and really bootstraps with a different share count. Accepted by the spec owner.

## 2. Differences from spec 02 not in B's diff (all ratified 2026-09-25)

| # | Where | Spec 02 | Program |
|---|---|---|---|
| 1 | `ClaimCreated.reason` | `Unavailable /* Paused \| Hook \| Frozen */` | `ClaimReason` (adds `PendingSale`). Emitted only for unavailable legs, so `PendingSale` never appears in this event. |
| 2 | `Basket.pending_router` | `Option<(Pubkey, i64)>` | `Option<PendingRouter { router, effective_ts }>`. The Borsh bytes are identical. |
| 3 | `Basket` | — | Trailing `reinvest_mask: u8`: the legs still owed a reinvestment slice (see §3). |
| 4 | Errors | 6000–6017 | Adds 6018–6024, listed below. |
| 5 | `bootstrap` | depositor[s] | The depositor must be the basket authority (`Unauthorized`). Otherwise anyone could front-run the bootstrap of an empty basket and set its composition. |
| 6 | `open_deposit_ticket` | basket (read-only) | basket is writable: it runs `observe` on every leg. |

Added error codes:
```text
6018 InvalidAccount     Account does not match the basket's records
6019 Unauthorized       Signer not authorised for this action
6020 NoClaim            No claim on this leg
6021 RouteViolation     Route spent more than allowed or touched a basket account it may not
6022 LegsStillLanded    Deposit ticket still holds landed legs; unwind them first
6023 RouterNotPending   Router allowlist full or router not pending
6024 InvalidArgument    Invalid argument
```

## 3. Rules the spec leaves open, as implemented

- **Share mint.** The client pre-creates it: classic SPL, 9 decimals, mint authority = the basket PDA, no freeze authority, supply 0. `initialize_basket` validates all of this. `usdc_mint` must be classic SPL Token.
- **Leg mints at init.** The extension set must equal the PreStocks set exactly (`UnexpectedExtensionSet` if any is missing or extra): TransferFeeConfig, ConfidentialTransferMint, DefaultAccountState, PermanentDelegate, TransferHook (null program), ConfidentialTransferFeeConfig, MetadataPointer, TokenMetadata, ScaledUiAmount and Pausable. **C's fixtures must carry the two confidential-transfer extensions.**
- **`redeem` remaining accounts.** The stride is 3 in both modes. In Usdc mode the third account of each leg is ignored.
- **`RedeemMode::Usdc { min_usdc_out }`.** Stored, not enforced; the per-leg `settle_leg_usdc` `min_usdc_out` is. `usdc_out` accumulates the USDC paid (reserve share plus sales).
- **`convert_listed_leg`.** Requires `Listing`, `now ≥ convert_after`, `C_i == 0`, `amount ≤ max_convert_chunk`, `amount ≤ owned_i` and the leg available. When `owned_i` hits 0 the leg retires, and `reinvest_mask` gets every `Active` leg.
- **`reinvest_reserve`.** The slice is the reserve divided by the number of legs still in the mask; the last leg takes the whole reserve. `usdc_amount` must equal the slice, and the measured reserve decrease must equal it too. A permissionless caller therefore can't skew the weights by reinvesting a dust amount.
- **Basket-signed router CPIs** (`unwind_leg`, `settle_leg_usdc`, `convert_listed_leg`, `reinvest_reserve`):
  - The sold vault may decrease by at most the allowed amount.
  - Every other basket token account the route lists (other vaults, and the reserve where not the target) must keep its balance.
  - Each of those accounts, and the target, must still be owned by the basket with no delegate or close authority.
  - The share mint may not appear.
  - Ratified as a spec rule: `route_v2` lists the basket's USDC ATA (= `usdc_reserve`) at index 2 in every basket-signed sell.
- **`finalize_deposit` / `abort_deposit` intermediates.** Each must be owned by the ticket PDA with amount 0. A Token-2022 intermediate with withheld fees would fail to close (none was seen on the fork). An account listed twice is skipped the second time.
- **Deploy build.** It has no on-chain IDL instructions (`no-idl` feature, default). The IDL is published at `programs/basket/idl/basket.json`.

## 4. Cloned-mainnet fork (surfpool 0.12.0, real PreStocks mints, live Jupiter `/swap/v2/build`)

**Run.** `tests/program/fork/run.sh` does the whole run:
- starts surfpool on port 8899, forked lazily from mainnet;
- deploys the exact deploy binary: `target/deploy/basket.so`, 374,704 bytes, sha256 `80db3bac…7dcc`;
- runs `fork.ts`;
- stops surfpool and deletes its state.

Transcript `tests/program/fork/transcript-final7.json`: fork slots 450,137,772 → 451,440,036, surfpool 0.12.0 (solana-core 3.0.6), 2026-09-24 20:32–20:34 UTC. It records every signature, CU figure, size, account count, CPI depth, the Jupiter request and the route. Nothing was signed for mainnet.

**Setup.**
- `initialize_basket` ran with the **7 real PreStocks mints**. The router allowlist is Jupiter v6.
- Bootstrap was in kind: 10,000,000 raw per leg, and each vault measured 9,900,000 (the 1 % fee).
- Routes came from live `/swap/v2/build` with `maxAccounts=30` and `slippageBps=150`.
- The taker is the ticket PDA (buys) or the basket PDA (sells), with `destinationTokenAccount` = the vault or the owner's USDC account.

**CPI depth is 4 on every leg of every instruction** (basket → Jupiter → AMM → Token-2022), for 1-hop and 2-hop routes. No route exceeded it.

### `ticket_swap_leg`, one leg per transaction or packed ($10 per leg)

| Leg | Route | CU | Accounts | Bytes | Jupiter out | Measured vault Δ |
|---|---|---|---|---|---|---|
| OPENAI | Whirlpool → Meteora DLMM | 186,987 | 35 | 909 | 4,977,444 | 4,979,301 |
| ANTHROPIC | Meteora DLMM | 116,043 | 24 | 659 | 9,393,933 | 9,379,935 |
| NEURALINK | Meteora DLMM | 117,730 | 25 | 630 | 22,287,865 | 22,287,865 |
| ANDURIL + POLYMARKET | Meteora DLMM ×2 | 237,720 (tx) | 34 | 877 | 59,450,622 / 67,505,681 | same |
| KALSHI + FIGUREAI | Whirlpool → Meteora DLMM; Raydium CLMM | 298,604 (tx) | 45 | 1,056 | 11,294,223 / 55,976,233 | 11,286,469 / same |

- `min_out` is Jupiter's `otherAmountThreshold`, checked by the program against the measured vault delta.
- `finalize_deposit` minted 502,959,696 shares, refunded the escrow and closed the ticket and all 8 ticket-owned token accounts, with rent returned to the owner.

### The full USDC deposit as a client sends it: **4 transactions**

Each leg's ticket-owned account creation is packed in with it. Greedy packing is limited by 64 locks and 1,232 bytes; the lookup tables are the basket's plus Jupiter's. All four transactions landed on the first attempt:

| Tx | Contents | Accounts | Bytes | CU | Signature (fork) |
|---|---|---|---|---|---|
| 1 | open + OPENAI (2-hop) | 50 | 1,064 | 306,057 | `3Rvh4E95…YV4` |
| 2 | ANTHROPIC + NEURALINK + ANDURIL | 46 | 1,159 | 422,574 | `aWuNNDmc…5SZ` |
| 3 | POLYMARKET + KALSHI (2-hop) | 45 | 1,124 | 361,224 | `3px2wg8y…MEv` |
| 4 | FIGUREAI + finalize (closes 8 accounts) | 48 | 1,015 | 242,690 | `aPE9Qgcd…FAr` |

**Legs per transaction: 3 at most; 2 when one of them is a 2-hop route or the open.** The byte limit binds before the 64-lock limit. The per-ticket static keys (ticket, escrow, and each leg's taker output account) cost 32 bytes each. **Plan for 4 transactions per deposit.**

### `settle_leg_usdc` (Usdc-mode redemption, 7 PendingSale claims; basket PDA as taker)

All 7 settled. Each CPI is 134–217k CU, 24–34 accounts and 588–679 bytes, at depth 4.

`route_v2` lists the basket's USDC ATA (= `usdc_reserve`) at index 2 in every one. The guard verified that it stayed unchanged.

One NEURALINK attempt (Meteora DLMM → Whirlpool) failed inside Whirlpool with `InvalidTickArraySequence` (stale tick arrays on the fork) and settled on the next route (Meteora DLMM → Orca V2). The failure changed nothing, because the whole instruction reverted.

### IPO rule

- `flag_listing` for ANDURIL ran. `convert_listed_leg` before `convert_after` was refused with `ConversionNotOpen` (0x177a).
- `surfnet_timeTravel` moved the fork 8 days forward, to epoch 1044. This crosses **PreStocks' real fee change at epoch 1043**: the conversion and reinvestment below paid 300 bps, while the deposit above paid 100 bps. No fee is stored anywhere in the program.
- `convert_listed_leg` ran twice (48,151,173 raw each): 7,781,508 and 7,770,994 USDC went into the reserve. The second call emitted `LegConverted` and `LegRetired`, and `reinvest_mask` became `0b1110111`.
- `reinvest_reserve` ran into all 6 remaining legs in equal slices (2,592,083–2,592,084 USDC, the last one taking the rest). Output was measured into each vault. The reserve ended at **0** and `reinvest_mask` at **0**.
- Measured outputs were 2.2–2.6 % below Jupiter's quote, which assumes the 100 bps of mainnet's current epoch. The slippage for these calls was raised to 500 bps.

### Prop AMMs on real mainnet state (simulation, nothing signed)

`tests/program/fork/mainnet-sim.ts` wrote `tests/program/fork/mainnet-prop-amm-sim.json`, simulated at mainnet slots 450,141,263–450,141,456 with `sigVerify:false` and `replaceRecentBlockhash:true`.

**Method.**
- For each AMM, `/swap/v2/build` was called with `dexes` restricted to that AMM (plus Meteora DLMM for the second hop), buying $10 of a leg it routes.
- Each route was simulated with three takers:
  - **wallet:** a system-owned wallet holding USDC (control);
  - **pda:** an off-curve PDA of the basket program id that doesn't exist on mainnet, so it is system-owned and empty;
  - **program:** an existing program-owned data account, Symmetry vault `G54nsr…jsmvdf` (owner `BASKT7…`, 30,659 bytes). It stands in for the basket and ticket PDAs, which are data accounts owned by the basket program.
- The pda and program takers were funded with 10 USDC by a transfer inside the same simulated transaction.

| AMM | Leg (route) | wallet | pda | program-owned |
|---|---|---|---|---|
| BisonFi | OPENAI (BisonFi → Meteora DLMM) | OK | OK | OK |
| Flux | OPENAI (Flux → Meteora DLMM) | OK | OK | OK |
| Quantum | OPENAI, KALSHI (Quantum → Meteora DLMM) | OK | OK | OK |
| TesseraV | KALSHI (TesseraV → Meteora DLMM) | OK | OK | OK |
| Hadron | ANTHROPIC (Hadron) | OK | OK | OK |
| 1DEX | OPENAI (1DEX → Meteora DLMM) | OK | OK | **FAIL:** `OwnerSystemProgramID` (26000) on account `user` |

**Conclusions.**
- BisonFi, Flux, Quantum, TesseraV and Hadron accept a program-owned PDA taker on mainnet. Their failures on the fork were fork artifacts, so they don't need to be excluded (C's `sell_now` quotes included).
- **Only 1DEX rejects the basket or ticket as taker**, and only because they are program-owned. A data-less PDA would pass. Keep 1DEX excluded.
- These were top-level swaps. The basket signs the same taker through CPI, and the AMMs see the same accounts and signer flag.

### Answers to open questions

- **`route_v2` needs the taker's own output account** (index 2), even with `destinationTokenAccount`. Without it Jupiter fails with `0x1789` (6025 InvalidTokenAccount): OPENAI and ANTHROPIC, in every run. Ruled on 2026-09-25.
- **1DEX requires a system-owned taker.** Its `user` constraint fails with Anchor `OwnerSystemProgramID` (0x6590) for the basket and ticket PDAs. Excluded everywhere; see `transcript-dev-try5.json` and `transcript-recheck-final6.json`.
- **Prop AMMs re-checked on a fresh fork** (`transcript-recheck-final6.json`, excluding only Manifest and 1DEX). Every one failed inside the AMM, every time:
  - BisonFi: "Unsupported program id", ×34 (surfpool cannot load the program).
  - Flux: `0x1773`.
  - Quantum: `0x9`.
  - TesseraV: `0xffff`.
  - Hadron: `0x3c`.

  They are fork artifacts: the mainnet simulation above shows all five accept a program-owned PDA taker. The final fork run pre-excludes them on the fork only.
- **Budget.** The largest single transaction was 422,574 CU (3 legs), well under 1.4 M.


## 5. Mutation checks

`tests/program/mutants/run.sh` builds four deliberately broken programs. Each one makes the suite fail (`tests/program/out/mutants.log`), and the original then rebuilds to the same hash:

| Mutant | Caught by |
|---|---|
| Redeem pays ceil instead of floor | Model replay: "leg 0 paid: model 3 chain 4"; entitlements and dilution tests |
| Open ticket escapes a shortfall (finalize ignores the loss index) | `test_open_ticket_bears_shortfall_pro_rata` |
| Paused leg paid instead of turned into a claim | 9 partial-redemption tests (Token-2022 `MintPaused` aborts the whole redemption) |
| Loss index never moves | 3 shortfall tests (state differs at the observe after a seizure) |

## 6. Devnet: built, rehearsed, not yet run

- **Deploy binary.** 374,704 bytes (sha256 `80db3bac…7dcc`; the no-idl default, reproducible).
  - Programdata rent is **1.904 SOL**. `solana program deploy` also needs a buffer of the same size during the deploy, refunded afterwards, so the peak is about **3.81 SOL**.
  - Loader-v4, which would avoid the buffer, is inactive on devnet (SIMD-0167).
- **Scenario suite** `tests/program/devnet/scenarios.ts`, in the six spec 02 fixture scenarios:
  - seizure;
  - pause-mid-redemption: one leg, several legs, seizure while a claim is open, settle after resume;
  - fee-change-mid-position;
  - multiplier-change-mid-position;
  - hook-switched-on;
  - frozen-vault.

  It records every signature in `tests/program/devnet/<scenario>.json`. Refusals never land, so they are recorded from a simulation of the signed transaction.
- **Rehearsal.** `devnet/dryrun.sh` ran the suite on a local test validator (mainnet Token-2022 binary, the deploy binary). All six scenarios pass and 89 checks pass.
- **Measured cost.** Setup is 0.169 SOL (7 fixture mints, fixture USDC, lookup table, user accounts). Each scenario is about 0.037 SOL. The total needed is **≈ 4.2 SOL peak and ≈ 2.3 SOL net**.
- **Fixture mints.** Agent C's `fixtures/registry.json` does not exist yet, so the suite creates its own seven fixture mints. `~/.config/solana/stocklana/program.json` is their issuer (mint, pause, freeze, fee, hook and multiplier authority, and permanent delegate).
- **Fee change on devnet.** The 300 bps fee takes effect two epochs (~2 days) later, so on devnet the suite proves the scheduled change and the old fee still applying. The effect itself is proven in LiteSVM and on the fork (the real epoch-1043 change).
- **Status.** The key has 0 SOL. `solana airdrop` failed at 19:41 and 20:42 UTC (rate limit).
