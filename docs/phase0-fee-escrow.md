# Phase 0: fee-aware escrow for Token-2022 transfer-fee mints

Investigation only. No code, scaffolding or git. Written 2026-09-24.

**How the data was collected.** Live reads came from mainnet RPC `https://api.mainnet-beta.solana.com`, with `https://solana-mainnet.gateway.tatum.io` as a fallback when rate-limited. Reference point: slot **450052737**, epoch **1041** (`getEpochInfo` → `{"epoch":1041,"slotIndex":340629,"slotsInEpoch":432000}`). Swap tests used Jupiter `lite-api.jup.ag/swap/v1`. Swaps were checked with `simulateTransaction` (`sigVerify:false`, `replaceRecentBlockhash:true`), using real holder wallets as `userPublicKey`. Nothing was signed or sent.

**How to read the sources.** An inline mint, tx signature or slot means the claim comes from an RPC read of that object. Source code is cited by crate version and line, or by pinned GitHub commit.

---

## Verdict

| Question | Result |
|---|---|
| **Q1: product or helper?** | **For the transfer fee alone, it's a helper.** Token-2022 ships the fee math, and Orca, Raydium, Meteora, Manifest and marginfi each carry their own ~40-line copy. The correct pattern (measure the balance change, compute the fee for the current epoch, harvest before closing) is well known. At least one Stocklana entry already implements it for PreStocks (volaryn). What's not a one-liner is the combination with the *other* PreStocks extensions and the issuer's ability to change rates and multipliers at short notice. That is a checklist plus reconciliation logic, not an escrow product. |
| **Q2: does anything fail today?** | **Yes, but not where the thesis says.** AMMs (Meteora DLMM, Raydium CLMM/CPMM, Orca) handle the fee correctly. Three failures are real: **(a) Kamino refuses any mint with a non-zero fee.** This is enforced in code; on-chain, zero reserves use any of the 11 mints. **(b) Jupiter's Manifest route mis-quotes PreStocks by the full 1% fee.** Swaps at ≤50 bps slippage revert on simulation, in both directions. **(c) A Stocklana lending entry (PreLendd) credits gross deposits,** so its vault is short by 1% on every deposit. The premise that nobody can support these mints is false for trading and true for mainstream lending. |
| **Q3: market size** | **92** mints with an active non-zero fee in Jupiter's verified and top lists. **12 are real assets:** 9 PreStocks, one of them the expired XAI, and 3 Tessera. Together they hold about **$3.8M liquidity and $10.8M 24h volume.** The other 80 are memecoins, 59 of them from one launchpad (Stonkfun). This is a small affected market. |
| **Q4: fee mechanics** | PreStocks changed its fee twice in 11 days. Each change gave about **37–39 h** of notice (Token-2022 enforces a minimum of epoch+2). A gross-up computed at deposit time under the old rate leaves the buyer **0.5% short** after the change. Passing a precomputed fee to `transfer_checked_with_fee` now **reverts** with `FeeMismatch`. |
| **Q5: other extensions** | The fee is charged on raw amounts; the scaled-UI multiplier only affects display, so accounting kept in raw units stays correct. But **multiplier changes arrived with 10 minutes and 29 minutes of notice.** Terms written in UI units break. Naive readers of the `multiplier` field still see "1" on SPACEX, whose real multiplier is 5. The permanent delegate, pause, and a hook that can be set later are larger threats to escrow than the fee is. **Tessera mints have none of these extensions,** so the brief's Q5 premise applies only to PreStocks. |
| **Q6: bounties** | **PreStocks disqualifies any project that also integrates a non-PreStocks pre-IPO token, so one project cannot target both bounties.** Stocklana closes **Fri 25 Sep 2026, 4pm ET.** Colosseum's Crypto World's Fair closes **12 Oct 2026, 11:59pm PT.** |
| **Q7: product shape** | **Don't build the "layer".** If this goes ahead, build a **working venue** that the incumbents won't list. PreStocks-collateral lending or escrowed OTC settlement are the candidates, and fee and extension handling there is table stakes, not the product. Details below. |
| **Q8: environment** | None of the 11 mints exist on devnet, so fixtures are required. `spl-token-cli 5.5.0` can recreate every PreStocks extension. Cost is under 0.05 SOL for fixtures plus about 2–4 SOL of refundable rent for a program deploy. |

Strictly by the brief's gate, **Q1 fails**: the fee alone is the right instruction plus a balance-change measurement. **Q2 partially survives**, because lending is closed to these mints. I answered Q3–Q8 anyway, because the data was collected in parallel and bears on whether a reframed idea is worth it.

---

## Mints under test (live read, slot 450052737)

Mint addresses come from the issuers' own APIs: `https://prestocks.com/api/prestocks` (8 entries) and `https://rest-api.tessera.pe/v1/public/token-details` (3 entries). A ninth PreStocks mint, XAI `PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx`, is not in the API. It was found through the authority's `setTransferFee` history. Its conversion deadline passed on 12 Sep ([PreStocks on X](https://x.com/PreStocks/status/2063623768535363940)).

| Issuer | Symbol | Mint | Current fee (`getAccountInfo` jsonParsed) |
|---|---|---|---|
| PreStocks | ANDURIL | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | older 50 bps @1032 → **newer 100 bps @1039**, maxFee u64::MAX |
| PreStocks | ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | same |
| PreStocks | FIGUREAI | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` | same |
| PreStocks | KALSHI | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` | same |
| PreStocks | NEURALINK | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` | same |
| PreStocks | OPENAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | same; multiplier → 1.4861347 |
| PreStocks | POLYMARKET | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` | same |
| PreStocks | SPACEX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | same; multiplier → 5 |
| Tessera | T-OpenAI | `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ` | 20 bps since epoch 987, maxFee u64::MAX, never changed |
| Tessera | T-Kalshi | `TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ` | 20 bps since epoch 922, never changed |
| Tessera | T-SpaceX | `TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v` | 20 bps since epoch 918, never changed |

**Extensions.** All 11 mints are owned by `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` and use 9 decimals.

- **PreStocks** mints carry `permanentDelegate`, `defaultAccountState`, `transferFeeConfig`, `confidentialTransferMint`, `confidentialTransferFeeConfig`, `transferHook` (programId **null**, authority set), `scaledUiAmountConfig`, `metadataPointer`, `pausableConfig` (paused:false) and `tokenMetadata`.
  - **One key holds every authority:** `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`. That covers mint, freeze, permanent delegate, fee config, withdraw-withheld, hook, multiplier, pause and metadata.
- **Tessera** mints carry only `transferFeeConfig`, `metadataPointer` and `tokenMetadata`.
  - Fee-config authority: `EXvTtxurWBUNNCtLojaN8ZBJFNJPZFSH3szoih9hh7YW`.
  - Withdraw-withheld authorities differ per mint: `DjMKLEZe…bzft` (T-OpenAI), `5P6aL1im…Vx5h` (T-Kalshi), `BnWEwDEZ…D2j7` (T-SpaceX).
  - Freeze authority `7n2PNcDXVDMK2m8dyV9cVPNY7p4jM4ZMHv7TzfibEt8o` is **not** mentioned in Tessera's docs, which name only the Fireblocks wallet `EXvT…` ([docs.tessera.pe on-chain programs](https://docs.tessera.pe/technicals/on-chain-programs.md)).

---

## Q1: Product or fifty-line helper?

### What the stack already handles

**Token-2022 program** (`spl-token-2022` 8.0.1, local crate source):

- **Fee calculation.** The fee is `ceil(amount × bps / 10000)`, capped at `maximum_fee` (`src/extension/transfer_fee/mod.rs:60-71`). The inverse `calculate_pre_fee_amount` is at `:91-116`.
  - Epoch selection is `get_epoch_fee`: the newer fee applies if `epoch >= newer.epoch` (`:152-158`).
  - The helpers `calculate_epoch_fee` and `calculate_inverse_epoch_fee` are at `:160-167`.
- **Fees are computed and withheld by the program itself** on every `TransferChecked`, using `Clock::get()?.epoch` (`src/processor.rs:352-359`).
  - The destination is credited `amount − fee`, and the fee goes into the **destination account's** `TransferFeeAmount.withheld_amount` (`src/processor.rs:509-527`).
  - `TransferCheckedWithFee` only *asserts* that the caller's fee equals the computed one, and fails with `FeeMismatch` otherwise (`src/processor.rs:402-406`).
  - The pause check sits in the same path, returning `MintPaused` (`:361-365`).
- **Fee changes** always take effect at `current_epoch + 2`. A second call while a change is still pending overwrites the pending value without shifting `older` (`src/extension/transfer_fee/processor.rs:89-107`).
- **Harvesting withheld fees to the mint is permissionless**; the instruction has no signer (`src/extension/transfer_fee/instruction.rs:132-134`, `processor.rs:178-202`).
- **Closing an account with `withheld_amount != 0` fails** (`src/processor.rs:1249-1251`). Upstream check at pinned commit: [token-2022 processor.rs#L1360](https://github.com/solana-program/token-2022/blob/8867f751c0f69367ba03af4f85510b5611989491/program/src/processor.rs#L1360-L1361).

**Anchor** (`anchor-spl` 0.32.2, local source):

- `token_2022_extensions/transfer_fee.rs` wraps `transfer_fee_initialize`, `transfer_fee_set`, `transfer_checked_with_fee`, `harvest_withheld_tokens_to_mint` and both `withdraw_withheld_*` as **thin CPIs** (lines 6, 35, 67, 107, 130, 162).
  - `transfer_checked_with_fee` takes a caller-supplied `fee: u64` (`:67-72`) and computes nothing.
- `anchor-lang` and `anchor-syn` 0.32.x contain **no** reference to `transfer_fee`, and there is no transfer-fee account constraint.
- `anchor-spl` 0.32.2 has **no** `pausable` or `scaled_ui_amount` module (`src/token_2022_extensions/` directory listing).
- Anchor does nothing automatic about fees.

**Existing on-chain implementations** (pinned commits, research sub-agent; I spot-checked Kamino, volaryn, PreLendd and Manifest):

| Protocol | Handles fee | Accepts PreStocks' extension set | Source |
|---|---|---|---|
| Orca Whirlpools | yes, `calculate_transfer_fee_excluded/included_amount` | only with a TokenBadge (permanent delegate, pausable, hook, default state need a badge) | [token.rs#L208-L420](https://github.com/orca-so/whirlpools/blob/408c945fef4c49ab70def4303377cfaf8f0f3c99/programs/whirlpool/src/util/v2/token.rs#L208-L420) |
| Raydium CLMM / CP-Swap | yes, `get_transfer_fee` / `get_transfer_inverse_fee` | only if admin-whitelisted | [clmm token.rs#L220-L330](https://github.com/raydium-io/raydium-clmm/blob/ed7c84a54ced59c55981780546adb0b4583dcf85/programs/amm/src/util/token.rs#L220-L330), [cp-swap token.rs#L254-L358](https://github.com/raydium-io/raydium-cp-swap/blob/59fb845a9e5bb569c8b2f3415f13b0c0ebcc6b92/programs/cp-swap/src/utils/token.rs#L254-L358) |
| Meteora DAMM v2 | yes | only with a badge | [token.rs#L70-L261](https://github.com/MeteoraAg/damm-v2/blob/a85c926607433f23f0ea60f4ca7b1ae92f4156cb/programs/cp-amm/src/utils/token.rs#L70-L261) |
| Meteora DLMM | yes (closed source; docs only) | only with a badge | [docs](https://docs.meteora.ag/core-products/dlmm/token-2022-support.md) |
| Meteora DBC | **rejects non-zero fee on quote mint; a badge can't override** | no | [docs](https://docs.meteora.ag/core-products/dbc/token-2022-support.md) |
| Manifest (CLOB) | yes: deposits the post-fee amount, nets output (HEAD `403f207`, 2026-09-23) | yes, trades them | `programs/manifest/src/program/processor/swap.rs:164-255,707-800` in [CKS-Systems/manifest](https://github.com/CKS-Systems/manifest) |
| Kamino klend | **rejects any non-zero fee**, older *or* newer | allows every other PreStocks extension | [constraints.rs#L42-L114](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src/utils/constraints.rs#L42-L114) (verified locally) |
| marginfi v2 | yes, grosses up deposit and withdraw | no extension allowlist found; banks are admin-created | [general.rs#L54-L118](https://github.com/mrgnlabs/marginfi-v2/blob/35b5c66aa6897c43e7199bd6c598134041e89f99/programs/marginfi/src/utils/general.rs#L54-L118) |
| Save/Solend | no; legacy `spl_token` unpack | no | [processor.rs#L3286](https://github.com/solendprotocol/solana-program-library/blob/mainnet/token-lending/program/src/processor.rs#L3286-L3288) |
| Meteora Presale Vault | yes: gross-up and net tracking on claim, refund and withdraw (closest to a production fee-aware escrow) | no (allowlist is fee, metadata and hook only) | [docs](https://docs.meteora.ag/helper-products/presale-vault/token-2022-support.md) |

**Libraries.** No crate or npm package offers "fee-aware escrow/vault accounting" as a reusable component. Searches: [crates.io](https://crates.io/search?q=token-2022%20transfer%20fee), [npm](https://www.npmjs.com/search?q=token-2022%20transfer%20fee%20escrow).

- The de facto library is the `spl-token-2022` interface itself; every protocol above wraps its helpers.
- The official escrow example ([program-examples take_offer.rs#L77-L128](https://github.com/solana-developers/program-examples/blob/df283ae3412049d6c98f4fb63d3a1c93ee5a96d2/tokens/escrow/anchor/programs/escrow/src/instructions/take_offer.rs#L77-L128)) ignores fees.
- Its `close_account` on the vault would fail for a fee mint, because of withheld fees. That is inferred from the close check above, not executed.

**Stocklana entries already doing this for PreStocks:**

- **binqbit/volaryn** (commit `2716ec2`, 2026-09-24) records `net_received` from the vault balance change on settlement ([exercise.rs#L89-L130](https://github.com/binqbit/volaryn/blob/2716ec2e144239195cb53414be3c00df752f3519/programs/volaryn/src/instructions/exercise.rs#L89-L130), verified).
  - It allowlists PreStocks' full extension set and rejects paused mints ([token.rs#L22-L60](https://github.com/binqbit/volaryn/blob/2716ec2e144239195cb53414be3c00df752f3519/programs/volaryn/src/token.rs#L22-L60)).
- **mystiquemide/holdfill** pins `fee_bps` on each order and checks balance changes on fill ([execute.rs#L130-L144](https://github.com/mystiquemide/holdfill/blob/8e4cc1365ccd1a238c34741aa2486cc96ea6be05/programs/holdfill_orders/src/instructions/execute.rs#L130-L144)).
- **solomonadzape95/offhrs** wraps PreStocks into a zero-fee SPL token, minting the measured change ([wrapper.rs#L191-L247](https://github.com/solomonadzape95/offhrs/blob/ffad9e7f6668fb7f2d058c4acecea80a4979e7fd/programs/stock_vault/src/wrapper.rs#L191-L247)).

### Every place the sent-versus-received gap bites

Numbers come from a line-for-line port of the Token-2022 fee math above, using the live PreStocks config (older 50 bps @1032, newer 100 bps @1039, uncapped).

1. **Escrow in (deposit accounting).** The vault receives `amount − ceil(amount·bps/1e4)`. Crediting `amount` overstates the liability by 1% on every deposit.
   - Live example: PreLendd's `deposit` credits `amount` after `transfer_checked` ([lib.rs#L234-L272](https://github.com/emmyCode4495/PreLendd/blob/b1ef411b499c5415bcc1a37d55dfac11782e5e21/programs/prestocks-lend/src/lib.rs#L234-L272), verified).
   - Fix: record the vault balance change.
2. **Hold.** Withheld fees sit in the vault's `TransferFeeAmount` and are *not* part of `amount`, so `vault.amount` is the true net balance.
   - But the vault **cannot be closed** until someone harvests (permissionless) or the withdraw authority sweeps. Escrow programs must CPI `harvest_withheld_tokens_to_mint` before `close_account`.
3. **Settle out (exact-out promises).** To deliver N net, send `calculate_pre_fee_amount(N)` at the current epoch's rate. If that gross-up was computed and stored at deposit time and the rate changed, the recipient is short (see Q4).
4. **Pro-rata splits.** Ceiling rounding is charged per transfer leg. Splitting 100 tokens three ways at 100 bps costs 1,000,000,002 raw in fees, against 1,000,000,000 for one transfer.
   - Transfers of 1–100 raw pay a fee of 1 raw. A 1-raw transfer pays a **100% fee**.
   - Dust handling and "who eats the rounding" are policy decisions.
5. **Refunds.** A refund round-trip pays the fee twice. Depositing 100 tokens nets 99.000000000 in the vault, and a full refund returns **98.010000000** (−1.99%).
   - Protocols must decide whether the depositor, counterparty or protocol absorbs this, and state it in terms.
6. **Rounding direction.** The inverse helper is documented as not an exact inverse: `calculate_fee(x) >= calculate_inverse_fee(x − calculate_fee(x))` (`mod.rs:118-125`). Gross-up can overshoot by 1 raw.
7. **Fee withholding and revenue.** Withheld fees in the escrow's own vault go to the issuer, not the escrow.
   - The PreStocks authority swept withheld fees **46 times** since 1 May. This is from `withdrawWithheldTokensFromMint` instructions signed by `WV9P…Fti5Wc`, found by `getSignaturesForAddress` plus `getTransaction` over 134 successful transactions.
   - PreStocks' ecosystem page says fees are distributed to holders via RevShare, but its Terms of Service say fees are "applied for our own account", and a sampled on-chain trail shows no holder distribution. See `docs/risks.md` §2 (updated 2026-09-25).
8. **Quoting (off-chain).** Any quoter that ignores the fee is wrong by the full rate. It happens live on Jupiter's Manifest route (Q2).

### What genuinely remains unsolved

The fee arithmetic is solved and small: call the Token-2022 helper for `Clock::epoch`, measure the balance change, harvest before closing. What no library packages is the **extension-hazard bundle for PreStocks-type mints**:

- **Pause:** settlement becomes impossible while paused.
- **Permanent delegate:** the vault can be debited by the issuer.
- **Transfer hook:** null today, but the authority can set one at any time. Programs must then forward extra accounts, and the hook can block transfers.
- **Default account state:** currently "initialized". The freeze authority could change it, and new vault ATAs would be created frozen.
- **Short-notice rate and multiplier changes.**

Each item is a few lines; together they form a checklist. That is useful, but it is audit knowledge, not a product customers pay for.

**Honest answer:** for the transfer fee, it's "use the right instruction and measure the balance change, and it works". The remaining difficulty lies in issuer-control extensions, not in the fee.

---

## Q2: Does anything actually fail today?

### Jupiter quotes: all 11 mints route

Source: `GET https://lite-api.jup.ag/swap/v1/quote?inputMint=USDC&outputMint=<mint>&amount=<n>&slippageBps=100`, run 2026-09-24 around slot 450053000. Figures are price impact as reported by Jupiter, with the route in brackets. On the buy side, Jupiter's `priceImpactPct` appears to include the transfer fee.

| Mint | $10 | $1k | $10k | $50k | $250k | Sell ≈$10k → USDC |
|---|---|---|---|---|---|---|
| ANDURIL | 0.8% (DLMM) | 1.0% | 2.2% | 7.2% | **63%** | $9,609 |
| ANTHROPIC | 0.0% (Manifest) | 0.0% | 1.8% | 2.1% | 3.7% | $9,835 |
| FIGUREAI | 3.9% (Manifest) | 3.9% | 5.8% | 6.4% | 13.8% | $9,140 |
| KALSHI | 1.7% | 2.3% | 3.0% | 5.0% | **44%** | $9,676 |
| NEURALINK | 2.6% | 3.3% | 5.3% | 25% | **87%** | $9,539 |
| OPENAI | 1.8% (Manifest) | 1.8% | 3.6% | 10.8% | **73%** | $9,773 |
| POLYMARKET | 0.05% (Manifest) | 1.3% | 2.6% | 6.9% | **98%** | $9,654 |
| SPACEX | 2.8% | 3.5% | 6.2% | 15.8% | **89%** | $8,726 |
| T-OpenAI | 0.42% (DLMM) | 0.42% | 1.1% | 3.5% | **100%** (HumidiFi > DAMM v2 > Raydium CP; no real depth) | $9,925 |
| T-Kalshi | 0.42% (DLMM) | 0.42% | 0.7% | 1.9% | 8.8% | $9,953 |
| T-SpaceX | 0.42% (DLMM) | 0.42% | 0.42% | 1.2% | 8.9% | $9,901 |

Routes use Meteora DLMM, Manifest, Raydium CLMM, Orca Whirlpool and the prop AMMs HumidiFi, Hadron, BisonFi, Kipseli, Quantum and Scorch. Beyond about $50k, most PreStocks books are thin.

### Quote versus actual delivery (simulated real swaps)

Each test: `POST lite-api.jup.ag/swap/v1/swap`, then `simulateTransaction` with `innerInstructions:true`, reading the user's output ATA before and after.

| Test | Route | Quoted out | Gross sent by pool | Received | Result |
|---|---|---|---|---|---|
| Buy ANTHROPIC with 1 SOL (user `2sujbbTj…CvD7`, slot 450054539) | **Manifest** | 110,971,920 | 110,962,607 | 109,852,980 | fee = 1,109,627 (exactly 1% of gross, rounded up). **Quote equals gross; overstated by about 1%.** |
| same, slot 450054548 | Meteora DLMM | 110,011,874 | 111,106,435 | 109,995,370 | quote ≈ net ✓ |
| same, slot 450054554 | Raydium CLMM | 109,611,046 | 110,719,812 | 109,612,613 | quote ≈ net ✓ |
| Sell 5 T-Kalshi (user `52Y1fg2s…cp5U`, slot 450054404) | Meteora DLMM | 2,231,225,018 | — | 2,231,225,018 | exact ✓ |
| **Buy ANTHROPIC via Manifest, slippage 50 bps** (slot 450054639) | Manifest | 111,032,674 (min 110,477,511) | 111,077,954 | — | **reverts: Jupiter `0x1771` (6001, SlippageToleranceExceeded)** |
| same at 100 bps / 150 bps | Manifest | — | — | — | passes, barely: gross × 0.99 lands just above minOut |
| Buy ANTHROPIC via DLMM, 50 bps (slot 450054671) | DLMM | — | — | — | passes ✓ |
| **Sell 0.5 ANTHROPIC via Manifest, 50 bps** (slot 450054678) | Manifest | 4,202,968,183 lamports | — | — | **reverts: `0x1771`** |
| Sell 0.5 ANTHROPIC via DLMM, 50 bps (slot 450054684) | DLMM | 4,454,590,513 | — | — | passes ✓ |

**Conclusion.** Manifest's on-chain program is fee-correct (see the Q1 table). **Jupiter's off-chain Manifest quote ignores the 100 bps PreStocks fee in both directions.** Any integrator using ≤50 bps slippage fails on these routes, and at 100 bps users silently receive about 1% less than quoted. Tessera routes through DLMM for every size up to $50k, and those quotes are correct.

This is a real live failure, but it's a quoting bug for Jupiter and Manifest to fix. An escrow product wouldn't address it.

### Pools

DexScreener: `api.dexscreener.com/latest/dex/tokens/<mints>` and `/token-pairs/v1/solana/<mint>`. Raydium v3: `api-v3.raydium.io/pools/info/mint`. Orca: `api.orca.so/v2/solana/pools?token=`. Largest-holder owners come from `getTokenLargestAccounts`, then `getMultipleAccounts` on each owner.

- **Meteora DLMM** has pools for **every** mint.
  - T-Kalshi's DLMM pool `CGYxcqLi…Fsuff` holds about 1,083 of 1,558 tokens.
  - T-OpenAI pool `2ZWxT3ni…MuKQY`: ~$608k liquidity, $839k 24h volume.
  - T-SpaceX pool `8obGpjiU…c4BT`: ~$575k liquidity.
  - Largest PreStocks pool: ANTHROPIC/SOL `EZyszDEx…LtU`, $283k liquidity, $1.07M 24h volume.
- **Raydium** (CLMM `CAMMCzo5…` and CPMM `CPMMoo…`) holds live pools for ANTHROPIC, OPENAI, POLYMARKET, KALSHI and FIGUREAI.
  - ANTHROPIC and OPENAI each have 49 pools above $100 TVL. Largest OPENAI CPMM: `9kgmRXdZ…3HHj`, $48.6k TVL.
  - Raydium also holds T-OpenAI and T-Kalshi in top-holder CLMM positions.
- **Orca Whirlpool** has live pools for ANDURIL (`ESMkG4xG…MwtQ`, $23.8k), KALSHI (`FumMQqEk…QxQ`, $13.7k), NEURALINK, OPENAI and POLYMARKET.
- **Hadron** (`HADRoNbL…VDQ8`) is among the largest holders of ANTHROPIC (581), FIGUREAI (1,706) and ANDURIL (353).
- **Manifest** vault `9R3wgE4G…2VVP` fills ANTHROPIC.

### Lending

- **Kamino.** `api.kamino.finance/v2/kamino-market` lists 43 markets. Scanning their reserves (`/kamino-market/<m>/reserves/metrics`, 261 reserves) found **0** reserves for any of the 11 mints.
  - An on-chain check agrees. I ran `getProgramAccounts` on `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` with a memcmp on `Reserve.liquidity.mint` at offset 128. The offset is validated: the same filter with USDC returns 147 reserves. **Zero reserves exist in any market, including permissionless ones.**
  - Cause, in code: `"Transfer fee must be 0 for liquidity tokens"` ([constraints.rs#L103-L114](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src/utils/constraints.rs#L103-L114)). Every other PreStocks extension is allowlisted (`#L42-L54`).
  - **The fee alone keeps PreStocks and Tessera out of Kamino.**
- **marginfi.** **Not verified.** The same `getProgramAccounts` approach returned 0 even for USDC on the public RPC, so the result is meaningless, and Tatum's gateway refuses gPA on its free plan. The code is fee-aware; whether any bank lists these mints is unknown.
- **Save/Solend.** Structurally unsupported (legacy mint unpack; see the Q1 table).
- **Hackathon lending entries** exist (PreLendd) but mis-account, as shown in Q1.

---

## Q3: Size of the problem

**Method.** I took the union of Jupiter's `tokens/v2/tag?query=verified` (3,690 tokens) and `tokens/v2/{toptraded,toporganicscore,toptrending}/24h?limit=100`. That gives 2,126 Token-2022 mints. I read each on-chain with `getMultipleAccounts` (jsonParsed) and applied `get_epoch_fee` at epoch 1041. Liquidity, volume and holder counts come from Jupiter's token API.

**Limitation.** This is a count of the *traded, indexed* universe, not every mint on Solana. A full census needs `getProgramAccounts` over Token-2022, which public RPCs block. Long-tail spam mints with no pools are therefore excluded. By definition they carry no liquidity.

| Group | Mints | Liquidity | 24h volume |
|---|---|---|---|
| All with `transferFeeConfig` | 104 | — | — |
| **Active non-zero fee** | **92** | $17.16M | $103.8M |
| Real assets: PreStocks (8 live + XAI) | 9 | $2.96M | $7.68M |
| Real assets: Tessera | 3 | $0.81M | $3.09M |
| **Real assets total** | **12** | **$3.78M** | **$10.76M** |
| Memecoins and other | 80 | $13.39M | $93.03M |
| …of which Stonkfun launchpad (withdraw authority `5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD`, [Solscan](https://solscan.io/account/5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD), [Bitquery](https://docs.bitquery.io/docs/blockchain/Solana/stonkfun-api/)) | 59 | $12.59M | $90.98M |

- **Fee rate distribution:** 300 bps × 46, 100 bps × 28, 20 bps × 3, 200 × 3, 60 × 3, 500 × 2, 1000 × 2, 690 × 2, and one each at 269, 111 and 400.
- **Largest non-RWA fee mints:** GP `HTmQz7My…YgUQ` (300 bps, $3.8M liquidity, $23.6M volume) and SI `DEW9dSN6…98DP` (100 bps, $1.08M). Both are unverified memecoins.
- **Jupiter's liquidity figures run higher than DexScreener's** for PreStocks because Jupiter counts Manifest and prop-AMM depth. ANTHROPIC shows $851k on Jupiter against $394k on DexScreener.

**Plain statement:** the real-asset market affected by transfer fees is **12 mints from two issuers, about $3.8M total on-chain liquidity and about $11M in daily volume.** Most fee-mint volume is 3% memecoins, which escrow and lending protocols have no reason to support.

---

## Q4: Fee mechanics in detail

### Live config (slot 450052737)

| | PreStocks (all 8, same values) | Tessera |
|---|---|---|
| `olderTransferFee` | 50 bps, epoch 1032, max u64::MAX | 20 bps, epoch 918/922/987 (init epoch) |
| `newerTransferFee` | **100 bps, epoch 1039**, max u64::MAX | identical to older, so never changed |
| `transferFeeConfigAuthority` | `WV9P…Fti5Wc` | `EXvT…h7YW` |
| `withdrawWithheldAuthority` | `WV9P…Fti5Wc` | per-mint (see table above) |
| Mint `withheldAmount` (raw) | ANTHROPIC 10,403,916,572; POLYMARKET 8,851,579,298; OPENAI 6,793,921,475; ANDURIL 953,082,937; KALSHI 805,167,441; NEURALINK 263,296,508; FIGUREAI 140,267,652; SPACEX 203,937 | T-OpenAI 22,756,805; T-Kalshi 14,843,305; T-SpaceX 0 |

**Epoch times** come from `getBlockTime` at the first slot of each epoch (epoch × 432000):

- 1030: 2026-09-07 03:12
- 1032: 2026-09-10 07:12
- 1037: 2026-09-18 05:06
- 1039: 2026-09-20 21:06
- 1041: 2026-09-23 13:06

All times UTC. **Correction (2026-09-25):** an epoch currently lasts about **32 hours** (measured 0.2657 s/slot; epochs 1039 and 1040 took 32.1 h and 31.9 h), not 2.6 days as first written. The notice hours in the table below came from real block times and are unaffected.

### Where withheld fees go

1. **Per transfer:** into the destination token account's `withheld_amount` (`processor.rs:516-527`). The account's spendable `amount` excludes it.
2. **Harvest:** anyone can move it to the mint's `withheld_amount` (permissionless).
3. **Withdraw:** only `withdrawWithheldAuthority` can move it to a destination, from the mint or directly from token accounts.
   - PreStocks has done this **46 times** since 1 May (`withdrawWithheldTokensFromMint` in the authority's transactions).
   - PreStocks' ecosystem page attributes the proceeds to holder revenue sharing via RevShare; its Terms of Service say fees are "applied for our own account" (see `docs/risks.md` §2).
   - Tessera's docs say the fee is split between referrer and treasury ([transfer fees](https://docs.tessera.pe/features/token-system-and-fees/transfer.md)).

### Can the issuer change the rate, and with what notice?

- **Yes.** A single key signs `SetTransferFee`.
- **Minimum notice** is set by the program: the new rate starts at `current_epoch + 2` (`transfer_fee/processor.rs:101`).
  - Calling at the very end of an epoch gives just over 1 epoch (about 32 hours). Calling at the start gives about 2 epochs (about 64 hours).
  - A pending change can be **overwritten** before it takes effect (`:96-107`).
- **There is no upper bound on the rate** except `MAX_FEE_BASIS_POINTS` = 10,000 (`:85-87`).

**Actual PreStocks history** (from `getSignaturesForAddress(WV9P…)` and `getTransaction` jsonParsed):

| Set at (UTC) | Slot / epoch | Mints | New rate | Effective | Actual notice |
|---|---|---|---|---|---|
| 2026-09-08 08:45 | 445296156 / 1030 | XAI (`5XJGdpML…Dznc`) | 50 bps | epoch 1032 = 09-10 07:12 | 46.5 h |
| 2026-09-08 16:24–16:39 | 445383184–445385888 / 1030 | all 8 (e.g. ANTHROPIC `wxko3Wa6…8Aypc`, SPACEX `3FPWMVz3…JibWYg`) | 50 bps | epoch 1032 | **≈ 38.5 h** |
| 2026-09-19 07:25–07:43 | 448339157–448343233 / 1037 | XAI + all 8 (e.g. ANTHROPIC `5dGWcJrE…vyr`, SPACEX `41de2db8…YUKD4`, ANDURIL `3jHo3hTX…FjACT`) | **100 bps** | epoch 1039 = 09-20 21:06 | **≈ 37.4 h** |

- **The rate before 2026-09-08 cannot be seen in current state.** Each `SetTransferFee` rolls `newer` into `older`, so only one prior rate survives. It would need a historical account read. It was likely 0, but that is **unverified**.
- The third-party Stocklana entry "toll" reports the same two dates ([README](https://github.com/Yonkoo11/toll/blob/890dc45249056dacb6030afc9a0f735869cf7a25/README.md)).
- No public PreStocks announcement of either change was found (research sub-agent).

### Does a mid-escrow rate change break accounting? Yes, in two concrete ways

Take the live config, a deposit at epoch 1038 and a release at epoch 1039 (100 bps). Note that at epoch 1038 the change was already *visible* as a pending `newerTransferFee`.

1. **Stored gross-up goes short.** An escrow that promised the buyer exactly 100.000000000 tokens net stored a release amount of `pre_fee(100e9 @50bps)` = 100,502,512,563 raw.
   - Released at 1038, the buyer gets 100,000,000,000.
   - **Released at 1039, the buyer gets 99,497,487,437, which is 502,512,563 raw (0.5%) short.**
2. **A stored fee reverts.** `transfer_checked_with_fee(amount=100,502,512,563, fee=502,512,563)` at epoch 1039 fails with **`FeeMismatch`**. Token-2022 recomputes fee = 1,005,025,126 (`processor.rs:402-406`).
   - If the program has no re-quote path, settlement is **stuck** until the code is upgraded.
3. **Correct design:** never persist a fee or gross-up. Compute with `calculate_epoch_fee(Clock::epoch)` at transfer time, use plain `transfer_checked`, and record the balance change.
   - When terms promise a *net* amount, read `newerTransferFee` at deposit and either fund to the worse of the two rates or refuse escrows that straddle `newer.epoch`.
   - A rate can still be *set* during an escrow and take effect two epochs later, so any escrow lasting more than about 32 hours is exposed. Terms must say who absorbs the difference.

---

## Q5: Interaction with the other extensions (PreStocks only; Tessera has none)

**Scaled UI amount.**

- The multiplier touches only `AmountToUiAmount` and `UiAmountToAmount` (`processor.rs:1438,1464`); nothing in the transfer path reads it. Fees are charged on **raw** amounts, so the rate in bps is unchanged by any multiplier.
- Example: 1e9 raw at 100 bps → fee 1e7 raw. That is 0.01 UI before SPACEX's ×5 and 0.05 UI after.
- **Raw-amount accounting stays correct across both a fee change and a multiplier change.** The two run on *different clocks*: the fee switches at an epoch boundary, the multiplier at a unix timestamp.

What breaks:

- **Terms written in UI units.** "Deliver 1 SPACEX" meant 1e9 raw before 2026-06-10 04:30 UTC and 0.2e9 raw after.
- **Short notice.** From `updateMultiplier` instructions signed by `WV9P…`:
  - **SPACEX → 5:** tx `EymeLSUs…yQ1G` at 2026-06-10 04:01, effective 04:30 (**29 minutes of notice**).
  - **OPENAI → 1.4861347:** tx `2bNNe87c…FAQ` at 2026-07-17 16:20, effective 16:30 (**10 minutes**).
- **Naive readers.** The stored `multiplier` field still reads `"1"` on both mints; the effective value is `newMultiplier` because `newMultiplierEffectiveTimestamp` has passed. Code that reads only `multiplier` values SPACEX 5× too low.
  - The PreStocks API already reports the scaled values: supply 43,712.53 = raw 8,742.506 × 5.
- **Capped fees.** With a capped fee, `maximum_fee` is raw, so its UI value would scale with the multiplier. PreStocks is uncapped, so this doesn't apply.

**Permanent delegate** (`WV9P…`). It can transfer or burn from **any** account, including escrow vaults. A vault's balance can therefore fall below recorded liabilities without the escrow program doing anything. Reconciliation must treat the actual balance as the source of truth and define what happens on a shortfall.

- **Live usage check:** scanned the authority's last 1,000 signatures (≈ March to September 2026) for authority-signed transfers or burns from accounts the authority does not own. Result: **0 uses** (see "Permanent-delegate usage" below). The power exists but has not been exercised in that window.

**Pausable.** When paused, all transfers, mints and burns fail with `MintPaused` (`processor.rs:361-365, 1013, 1100`). An escrow cannot settle *or refund*. Deadlines and expiry logic must tolerate pauses; otherwise a pause at expiry lets one side win by default.

**Transfer hook** (programId currently null, authority set). The issuer can attach a hook later. Programs that CPI plain `transfer_checked` without the extra accounts will then fail with `MintRequiredForTransfer` or hook errors. Plan the account forwarding now, or check `programId == null` and refuse otherwise (volaryn does the latter).

**Default account state** is currently `initialized`. Updating it is a freeze-authority action, so newly created vault ATAs could start frozen.

**Confidential transfer** is configured with `autoApproveNewAccounts:false`. It doesn't affect public-balance escrows.

---

## Q6: Bounties and track fit

Sources: the [Stocklana page](https://hackathons.solana.com/hackathons/stocklana) (fetched 2026-09-24) and the research sub-agent's verbatim capture.

- **Deadline:** "Submissions close: Friday 25 September, 4:00pm ET" (`2026-09-25T20:00:00Z`). Judging runs through 2 October.
- **Rules:** one submission per team; at least one link (GitHub, demo or video).
- **Judging question:** "could this be a real app that people will actually use?"
- **PreStocks, $10,000 (5k / 3k / 2k).** "Build your project using PreStocks … new ways to trade or use them through derivatives or DeFi integrations … lending/collateral, structured products …"
  - **"Note: projects that integrate any non-PreStocks pre-IPO tokens will be ineligible for this bounty."**
  - API: [prestocks.com/api/prestocks](https://prestocks.com/api/prestocks) (no auth; returns 8 tokens with prices and scaled supply). There is **no developer docs site**; docs.prestocks.com does not resolve and /docs returns 404.
- **Tessera, $6,000 (split unstated).** "Create a product or usecase with OpenAI or Kalshi T-Tokens … existing bonding curves such as Stonkfun, memes, or anything that drives value to pre-IPO Tessera tokens."
  - Docs: [docs.tessera.pe](https://docs.tessera.pe/). API: [rest-api.tessera.pe/v1/public/token-details](https://rest-api.tessera.pe/v1/public/token-details).
  - No exclusivity clause.

**Fit.** A generic, issuer-agnostic fee-aware escrow layer **is ineligible for PreStocks** if it integrates Tessera, and it is a weak fit for either track. Both reward products that drive usage of *their* token, not infrastructure. The PreStocks brief does list "lending/collateral" and "DeFi integrations", so a PreStocks-only venue fits there.

Competition in that lane already includes volaryn (fee-aware protection escrow), holdfill (standing orders), offhrs (zero-fee wrapper) and PreLendd (lending). There were 227 submissions at fetch time.

**Colosseum Crypto World's Fair** ([colosseum.com/worldsfair](https://colosseum.com/worldsfair), [rules PDF](https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf)):

- **Dates:** 6:00am PT 14 Sep 2026 to **11:59pm PT 12 Oct 2026**. Winners by 5 Dec.
- **Submission:** GitHub link (private allowed if shared with hackathon@colosseum.com), a 2–3 minute pitch video and a ≤3 minute product demo.
- **Judging:** functionality, impact, novelty, UX, open-source/composability and business plan.
- **Prizes:** $30k grand champion, 20 × $15k, and a $100k Solana track spread over 10 products; accelerator consideration.
- **Prior work** is allowed if disclosed, and only work inside the window is judged. Stocklana (from about 18 Sep) falls inside that window; this is an inference, not stated in the rules.

---

## Q7: What the product would be

**Recommendation: don't build a fee-aware escrow layer.** Not as a crate, program or SDK. The evidence:

- The fee math is ~40 lines already present in `spl-token-2022`.
- Every serious AMM carries its own copy.
- Competing hackathon entries already implement the pattern correctly.
- The affected real-asset market is 12 mints with about $3.8M of liquidity.
- The incumbent that excludes these mints (Kamino) does so as **policy**, in one `if`. A third-party crate doesn't change that policy.

**If anything is built, make it a working venue for PreStocks only**, where fee and extension handling are table stakes rather than the product. The live gap is **collateral**: Kamino rejects these mints by rule, Save can't parse them, and the one hackathon lending entry mis-accounts.

**Smallest demonstration that proves it:**

1. An Anchor program on devnet with one vault per PreStocks-like fixture mint.
2. Deposit credits the vault's balance change.
3. Withdraw and refund compute the fee at the current `Clock::epoch`.
4. Harvest runs before close.
5. Settlement refuses to run while the mint is paused, and checks that the hook program is null.
6. Accounting stays in raw units; the UI converts using the effective multiplier.
7. A reconciliation instruction flags any shortfall caused by the permanent delegate.

A test suite on LiteSVM or bankrun must show:

- Deposit → rate change scheduled → warp 2 epochs → settle is still exact, while a naive stored-fee version reverts with `FeeMismatch`.
- A three-way pro-rata split with visible rounding.
- A refund round-trip at −1.99%.
- A pause at expiry.
- A multiplier change mid-escrow with raw balances unchanged.

This is two to four days of work. Whether the *venue* (lending or OTC for PreStocks) has demand is a separate question this phase did not test.

**Cheaper side result.** The Jupiter/Manifest mis-quote is reproducible with the transactions above and worth reporting to Jupiter and Manifest. It is not a product.

---

## Q8: Environment

- **Devnet:** `getMultipleAccounts` on `https://api.devnet.solana.com` (slot 503514659) returns **null for all 11 mints**. Fixtures are required.
- **Fixture fidelity.** `spl-token-cli 5.5.0` (local) supports `--transfer-fee-basis-points`, `--transfer-fee-maximum-fee`, `--enable-permanent-delegate`, `--enable-pause`, `--ui-amount-multiplier`, `--transfer-hook`, `--default-account-state`, `--enable-metadata`, `--enable-confidential-transfers` and `--enable-freeze`. It also has `set-transfer-fee`, `update-ui-amount-multiplier`, `pause` / `resume` and `withdraw-withheld-tokens` subcommands.
  - Every PreStocks extension can be reproduced.
  - Exception: the null-program hook with an authority set is **unverified**. The CLI flag takes a program ID.
- **Epoch-dependent tests.** Scheduled fee changes need a local validator or LiteSVM/bankrun with clock warping. Devnet epochs take real time, so waiting out epoch+2 there isn't practical.
- **Costs** (`getMinimumBalanceForRentExemption` and `solana rent`):
  - PreStocks-shaped mint (911 bytes on mainnet): 0.00528 SOL.
  - Tessera-shaped mint (492 bytes): 0.00315 SOL.
  - PreStocks token account (191 bytes: immutableOwner, transferFeeAmount, transferHookAccount, pausableAccount): 0.00162 SOL.
  - Ten fixture mints plus 50 token accounts: about **0.15 SOL**.
  - Program deploy rent: 200 KB = 1.017 SOL, 300 KB = 1.525 SOL, 400 KB = 2.033 SOL. The temporary buffer roughly doubles that during a deploy, and both are refundable on close. Budget **2–4.5 SOL peak**.
  - The local devnet keypair `68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf` holds 3.35 SOL. Top up via faucet before deploying.

---

## Permanent-delegate usage

**What was scanned.** All successful transactions signed by `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`: **963** in total, from 2026-03-03 20:21 to 2026-09-24 00:08 UTC (`getSignaturesForAddress` limit 1000, then `getTransaction` jsonParsed). The scan covered top-level and inner Token-2022 `transfer`, `transferChecked`, `burn` and `burnChecked` instructions. It flagged any where the authority is `WV9P…` but the source account's owner, taken from `pre/postTokenBalances`, is someone else.

**Result: 0.** In that window the permanent delegate was never used to move or burn tokens out of holders' accounts, and that includes pool and escrow vaults.

Any use of the permanent delegate must be signed by this key, so the scan is complete for the window. Activity before 2026-03-03 was not scanned. **Update 2026-09-25:** that earlier window does contain delegate use. On 2025-09-19 the delegate emptied 29 holder accounts to zero; see `docs/risks.md` §2.

---

## Not verified in the time available

- **marginfi.** Whether any bank lists these mints. Public RPC gPA returned empty even for USDC.
- **PreStocks fee before 2026-09-08.** Needs a historical account read.
- **PreStocks official notice of either fee change, and the RevShare distribution mechanics.** Only site copy, via the sub-agent.
- **Meteora DLMM on-chain fee handling.** Closed source. Inferred correct from the live simulations (quote ≈ net).
- **Whether Manifest's fee handling is deployed** at program HEAD `403f207`. The simulations show the vault receiving net amounts, which is consistent with it.
- **Tatum as a data source.** Some reads fell back to Tatum's gateway. Its responses were not cross-checked against a second provider.
- **Full-chain count of fee mints.** Q3 covers only Jupiter's indexed universe.
