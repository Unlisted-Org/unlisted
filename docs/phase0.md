# Phase 0: PreStocks basket token

Investigation only: no program code, no frontend, no scaffolding, no git. Written 2026-09-24.

The previous Phase 0 report (fee-aware escrow) was moved to `docs/phase0-fee-escrow.md`.

**Method**
- **RPC.** Live reads on mainnet `https://api.mainnet-beta.solana.com`, with `https://solana-mainnet.gateway.tatum.io` as a fallback when rate-limited. Devnet reads and writes went to `https://api.devnet.solana.com`.
- **Swaps.** Quotes came from Jupiter `lite-api.jup.ag/swap/v1/quote` and `api.jup.ag/swap/v2/build`. Every mainnet swap and custody claim was checked with `simulateTransaction` using `sigVerify:false` and `replaceRecentBlockhash:true`. Nothing was signed on mainnet: the local keypair holds 0 mainnet SOL, and I did not touch the other keypairs in `~/.config/solana`.
- **Devnet.** Issuer-control claims were proven with real, confirmed devnet transactions against a fixture mint.
- **Scratch files.** All scripts and raw responses are in the session scratchpad, not in the repo.

Labels used below:
- **Proven:** a transaction was confirmed or simulated, or the figure was read live, at the slot given.
- **Reported:** comes from docs or a research sub-agent and was checked only where stated.
- **Unverified:** stated as such.

---

## Decisions recorded after Phase 0 review (2026-09-24)

1. **SpaceX is excluded. The basket is seven names:** OpenAI, Anthropic, Neuralink, Anduril, Polymarket, Kalshi, FigureAI.
   - The product rests on one sentence: *a basket of companies that are not yet public*. SpaceX listed as SPCX on 2026-06-12, so including it contradicts that sentence.
   - The PreStocks page says the SPACEX PreStock "must be swapped into $SPCXx or any other token before 11:59pm UTC on 12 March 2027, or [it] will expire worthless". That puts an expiry inside the product's first year.
   - It trades 21% below SPCXx: $117.10 against $148.31 on Jupiter price v3, blocks 450074444 and 450076942.
   - It is the thinnest large leg: 17.6% round trip at $5k (Q5 depth ladder).
   - This was a checked decision, not an omission. The same rule applies to any constituent that later IPOs; see Q6.
   - XAI `PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx` stays excluded (conversion deadline passed on 12 Sep 2026).
2. **Holdings-based pricing is accepted.**
   - The program contains no price. Mint and redeem are computed from the vault's actual holdings (Q5).
   - The app shows three clearly labelled values: *what you'd get selling now*, *last trade*, and *PreStocks' reference*. It never implies a single true price. That honesty about which value is which is a product feature, not a caveat.
3. **Devnet only, now and later.** No mainnet wallet. Everything is built on fixture mints.
   - The fixtures are first-class: they mirror each real mint extension for extension, with a documented diff (Q8 showed the diff is empty).
   - A signed test suite covers every scenario a real holder is exposed to: seizure from the vault, a pause mid-redemption, a fee change mid-position, a multiplier change mid-position, and a hook being switched on.
   - These scenarios need the issuer's keys, so they **cannot** be run on mainnet. That is the answer to "why isn't this on mainnet".
4. **Symmetry check** (below): done before Phase 1.
5. **Specs:** the share and pricing spec, the on-chain interface, and the valuation API are settled in one pass before the three-agent split.
6. **Jupiter / Manifest over-quote reported upstream:** [Bonasa-Tech/manifest#735](https://github.com/Bonasa-Tech/manifest/issues/735) (root cause, in the adapter) and [jup-ag/jupiter-swap-api-client#65](https://github.com/jup-ag/jupiter-swap-api-client/issues/65). Both were posted from the 1nonlypiece account with fresh reproduction slots 450095131–450095187.

Sections below that still mention SPACEX (the Q2 and Q5 tables) are the original eight-mint measurements, kept as evidence. Seven-name figures will be recomputed in the spec.

---

## Symmetry check: does a live basket protocol already handle these mints?

**Why it matters.** Symmetry (program `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`, SDK `@symmetry-hq/sdk` 1.0.22) is a permissionless, live basket protocol. If it handles PreStocks correctly, anyone could create this product there with no code.

**Method.**
- **Static.**
  - Docs: [llms-full.txt](https://docs.symmetry.fi/llms-full.txt).
  - SDK source: npm tarball 1.0.22.
  - Deployed program binary: `solana program dump`. The program was last deployed in slot 443194628; its upgrade authority is `9A5V7smsUMRNNzvrawbDx3ZexZR3LY1bcEUXUiMJ2bxk`.
- **Live state.** All 39 vaults from `fetchAllVaults()`, reconciling each Token-2022 holding's recorded `amount` against the vault's actual token-account balance.
- **Execution.** Symmetry's **real program** ran on a local mainnet fork (surfpool 0.12.0, lazily forked at slot ~450094040) against **live vault NIT** `G54nsrBx9a59YVqiqk2Sg3yX9wQauRz5MEugdWDjvmsf`, which holds xStocks with the same pausable and permanent-delegate extensions as PreStocks.
  - A fresh local key was given 100,000 NIT shares with `surfnet_setTokenAccount`.
  - Each scenario ran Symmetry's own `sellVaultTx` then `redeemTokensTx` (fast in-kind withdrawal, all tokens kept).
  - Pause and seizure were produced by editing account state on the fork only. **Nothing was sent to mainnet.**

| Exposure | Symmetry | Evidence |
|---|---|---|
| **100 bps transfer fee** | **Handled.** Credits the net amount received. | **Live, mainnet.** Vault STKPILOT `62hdkRCNFwrcPTQ7yoFjVdVBU6yyp4PwCGfjsspErgoo` holds LOOM `CB1YQfUzgsnaCd93cZLdiX1uASW7utWBaYMUsvcwNUBV`, a 300 bps fee mint, at 100% weight. Inflow tx `D89FULZ2mmCJGiRR…` transferred 14,533,669,008,755 gross; the 3% fee rounded up is 436,010,070,263, leaving 14,097,658,938,492 net. Outflow tx `DcC3dTqmbojg9v5N…` sent 59,147,719,143. The remainder is 14,038,511,219,349, which equals **both** Symmetry's recorded amount **and** the actual ATA balance, to the unit. The binary also contains the error string "Transfer fee calculation error". |
| **Pausable mint** | **Not handled.** One paused constituent blocks the whole redemption, after the shares are already burned. | **Fork, real program.** The baseline sell and redeem succeeded (redeem tx `2FYvNMjA…`, which delivered NVDAx 5,213, AAPLx 1,855, AMZNx 2,464, …). Pausing NVDAx `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` between sell (tx `4zuKr9Fs…`) and redeem made the redeem revert inside `BASKT7…` with `custom program error: 0x43`, logged as "Transferring, minting, and burning is paused on this mint". **None of the other five held constituents (wSOL, AMZNx, GOOGLx, AAPLx, MSFTx) was delivered**, and the 50,000 shares had already been burned at sell. A retry failed the same way. After resume, redeem succeeded (tx `DS7NXvUa…`). The binary has no pause-related strings: there is no pre-check and no partial redemption. |
| **Permanent delegate (seizure)** | **Not handled.** Accounting is record-based, so a seizure goes undetected and all redemptions fail. | **Fork, real program.** The vault's AAPLx balance was set to 0, as a permanent-delegate burn would do. Symmetry still recorded **21,618** AAPLx. Sell succeeded (tx `4PNVhh6L…`) and burned 50,000 shares. Redeem then reverted with Token-2022 `insufficient funds` (`0x1`). **No constituent was delivered**, and recorded AAPLx stayed nonzero (19,763 after the sell). **Live mainnet corroboration** that Symmetry doesn't reconcile to balances: vault STACCINDEX `572noYJccA4SgmPA27UgA6sjNZDGuPc3NH2mgPoKjRYr` records Staccana 465,500,693 against an actual 143,744,608,698; the surplus is invisible to it. |
| **Scaled-UI multiplier** | **Not handled in code, and only matters for some oracles.** | The SDK and binary contain no scaled-UI or multiplier logic ("multiplier" appears only as the oracle `conf_multiplier`). Raydium CLMM/CPMM oracles price per raw unit, so a multiplier change can't break those valuations. For **Pyth**-priced legs (price per share), a multiplier change would misvalue raw balances. **Not executed:** Pyth Hermes returns 401 without a key, so I couldn't run a price update on the fork. |
| **Oracle coverage for the 7 names** | **3 of 7 cannot be priced.** | Symmetry's oracle types are Pyth, Raydium CLMM, Raydium CPMM, LST, plus Byreal CLMM in the binary. **No Meteora DLMM or Manifest**, which is where most PreStocks liquidity sits. Pyth covers only OpenAI and Anthropic. Raydium's best pools by liquidity (`api-v3.raydium.io/pools/info/mint`, today): **ANDURIL $0, KALSHI $6, NEURALINK $6**. ANTHROPIC $253k, FIGUREAI $76k, OPENAI $45k (CPMM) and POLYMARKET $22k are priceable. |

**Verdict: Symmetry does not handle these mints correctly. That gap is the reason this project exists.** Precisely:

1. **It gets the transfer fee right.** That is not the differentiator, and the pitch must not claim it is.
2. **A single paused name locks every holder's whole redemption**, with shares already burned. Proven by executing Symmetry's own program. PreStocks' pause is controlled by a 2-of-7 multisig with no time lock.
3. **A seizure by the permanent delegate breaks all redemptions**, because Symmetry trusts its own records over the chain. Proven the same way. The same 2-of-7 multisig holds the permanent delegate.
4. **Three of the seven names have no price source Symmetry supports**, so a seven-name PreStocks basket cannot be configured there today.

**What the purpose-built version must do differently:**
- Pause-aware partial redemption (Q4 design).
- Balance-as-truth accounting with explicit shortfall handling.
- No oracle dependency at all (holdings-based mint and redeem).
- Each of these demonstrated with signed fixture scenarios.

---

## Verdict

| Q | Answer |
|---|---|
| **Q1: already built?** | *(See the Symmetry check above: Symmetry gets the transfer fee right but fails on pause, seizure and oracle coverage; proven on a mainnet fork.)* **No working, deployed, backed PreStocks basket token exists.** The closest code, Intellihackz/basket, is localnet-only and takes its prices from the caller; its program ID doesn't exist on mainnet or devnet. The closest live product, Indexify, gives no token: each constituent sits in the user's wallet, and it holds about $3k (reported). **The real threat is Symmetry**, a live mainnet basket protocol. Anyone could create this basket there today, and nobody has (73 program accounts, none referencing a PreStocks mint). **Not killed.** |
| **Q2: does the fee make it pointless?** | **The cost pitch is dead; the product isn't necessarily.** Minting through the index can at best **match** buying the eight tokens directly. Live round-trip cost (buy all eight, then sell back): **2.5% at $10, 2.8% at $100, 3.3% at $1k, 4.0% at $10k, 6.9% at $50k.** About 2.0 points of that is the two 1% transfer fees; the index cannot avoid them. A careless design adds 1% per extra hop. The index is cheaper only in account rent at small sizes and in a **secondary market for the index token**, where transfers pay no PreStocks fee at all. The honest reason to exist is one transferable, composable position, not lower cost. |
| **Q3: how does a user get in?** | **Eight swaps can't fit in one transaction.** Proven: at the default `maxAccounts` even two legs overflow 1,232 bytes; at `maxAccounts=20`, five legs fit (1,206 bytes, 52 accounts) and six don't. **Recommendation:** the program CPIs Jupiter v2 `/build` routes with the vault PDA as taker, 4 legs per transaction. That makes **2 transactions per deposit** under one wallet approval, with a deposit ticket tying them together. **Exclude Manifest or check the balance change on-chain:** Jupiter's Manifest quotes are still 1.000% too high, proven on 5 of 8 legs. |
| **Q4: custody** | **Proven for all 8 mints (simulated, slot ~450072000):** a program PDA can own an associated token account for each mint (191 bytes, 0.00162 SOL rent), receive into it (9,900,000 of 10,000,000; 100,000 withheld), and have its withheld fee harvested to 0 without a signature. **Proven on devnet with real transactions:** the permanent delegate burned 2.5 tokens out of a PDA vault without the vault signing; a paused mint rejects transfers (`MintPaused`, 0x43); a frozen default state makes new vault accounts unusable (`AccountFrozen`, 0x11). **The issuer is a 2-of-7 Squads multisig with no time lock**, not "one key". |
| **Q5: pricing** | **No oracle can price this basket on-chain.** Pyth has catalog entries for OpenAI and Anthropic (indicative, 1 publisher minimum, API key required) and SPCX, but nothing for the other five. The PreStocks `markPrice` is an off-chain estimate refreshed about every 5 minutes, up to **31% away from where the token trades**. Jupiter's last-trade price was as much as 84 minutes old for FIGUREAI. **Recommendation:** mint and redeem price from the vault's own composition, pro-rata, with no oracle in the program. The product shows three labelled values: what you'd get if you sold now at your size, last trade, and PreStocks mark. |
| **Q6: weights** | Weighting by PreStocks `markValuation` puts **94.5%** in three names: SpaceX 37.5%, Anthropic 32.6%, OpenAI 24.4%. **SpaceX has already IPO'd; its PreStock trades 21% below SPCXx and expires worthless after 12 Mar 2027.** Equal weight is the only real "basket", but it is capped by thin legs: FIGUREAI costs 10.4% round trip at $10k per leg. "No rebalancing" conflicts with a holding that has a hard expiry. |
| **Q7: World's Fair** | Deadline **12 Oct 2026, 11:59pm PT.** Needs a pitch video (2–3 min, "most important element"), a demo video (≤3 min) and a GitHub repo. Judged on functionality, impact, novelty, UX, open source/composability and business plan. **Strong:** UX story and working on-chain mechanics. **Weak:** novelty (Symmetry, Cesto, Indexify, many Stocklana baskets), market size (about $3.8M of on-chain liquidity across the eight), legal and issuer risk. |
| **Q8: environment** | **None of the eight exists on devnet** (re-checked at slot 503544362). **Proven:** one `spl-token-cli 5.5.0` run reproduces PreStocks' exact extension set on devnet, including a null hook program with a live authority, for 0.0052 SOL. Devnet has no Jupiter or PreStocks liquidity, so the convincing demo is **mainnet with small real positions**: about 2.5–3.6 SOL refundable deploy rent plus a basket of $50–$200. **That needs a funded mainnet wallet, which this machine doesn't have.** |

**Bottom line.** Neither kill question kills it outright. Q1 finds no working competitor, though Symmetry could host one at any time. Q2 forces an honest pitch: minting is not cheaper than doing it yourself; the value is one fee-free transferable token. Three findings need your decision before Phase 1:

1. SpaceX is no longer pre-IPO and expires in March.
2. The pricing design (Q5) has to be settled first.
3. A mainnet wallet is needed for the demo.

---

## Mints, re-verified live

`getEpochInfo` → epoch 1041, slot 450070517. `getMultipleAccounts` (jsonParsed) at slot **450070519**. Mint list from `https://prestocks.com/api/prestocks` (8 entries). XAI `PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx` is excluded as instructed.

| Symbol | Mint | Fee now | Effective multiplier (stored `multiplier` field) |
|---|---|---|---|
| ANDURIL | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | 100 bps | 1 (1) |
| ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | 100 bps | 1 (1) |
| FIGUREAI | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` | 100 bps | 1 (1) |
| KALSHI | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` | 100 bps | 1 (1) |
| NEURALINK | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` | 100 bps | 1 (1) |
| OPENAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | 100 bps | **1.4861347** (field still reads 1; `newMultiplierEffectiveTimestamp` 1784305800 has passed) |
| POLYMARKET | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` | 100 bps | 1 (1) |
| SPACEX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | 100 bps | **5** (field still reads 1; timestamp 1781065800 has passed) |

**Common to all eight:**

- **Fee config:** `newerTransferFee` = 100 bps from epoch 1039; `olderTransferFee` = 50 bps from epoch 1032; `maximumFee` = u64::MAX, so there is no cap.
- **Extensions:** `pausableConfig.paused:false`, `transferHook.programId:null`, `defaultAccountState:initialized`.
- **Authorities.** Mint, freeze, permanent delegate, fee config, withdraw-withheld, hook, multiplier, pause, metadata-pointer, metadata-update and confidential-transfer all resolve to **one address**: `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`.

**Correction to the brief: that address is a Squads v4 multisig vault, not a single key.**

- In withdraw tx `4d1NAhQDAEsLddEV7sm8YyqjaDvNzPe5a7dyTSJSH82c5tKSkBb9L7LzjfayyXXtKtGvHuLRHQoaBYUuNv1Qbs7Z`, the top-level program is `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`. The transaction was signed by member `Cxr1P9uT…DyW`, with `WV9P…` passed as the vault.
- Decoding multisig account `53Ab3Rqx1a5uiV7qmsX4qbdbrqstVDpnH4LoJGfsZsU8` (slot 450080146) gives:
  - **threshold 2**
  - **7 members**, 5 with vote and execute rights
  - **time lock 0 s**
  - config authority unset, so members can only change through a multisig vote
  - transaction index 484
- **Any 2 of 5 voting members can pause, seize or change the multiplier instantly.** Fee changes still wait for epoch+2.
- The issuer's past behaviour (fee changed twice in 11 days, multiplier notice of 10 and 29 minutes) was established in the previous report (`docs/phase0-fee-escrow.md`, Q4/Q5) from that authority's own transactions. I did not re-derive it here.

---

## Q1: Has this already been built?

**Prior-art search.** A research sub-agent covered GitHub (repo and code search), the Stocklana page, PreStocks' ecosystem page (in `prestocks.com/_next/static/chunks/985-f609a54b5bab08a7.js`), Colosseum and basket protocols. I independently checked the three closest results.

| # | What | Backed token? | Deployed? | How close | Checked by me |
|---|---|---|---|---|---|
| 1 | **Intellihackz/basket** (`onchain/basket-vault`), commit `35b0141d` on 2026-09-18 ([README](https://github.com/Intellihackz/basket/blob/35b0141dd12681299eda51d13a8253a1bb35e2e8/onchain/basket-vault/README.md)) | Yes: pooled vault, share token, Jupiter swaps signed by the vault, measures the balance change after each swap | **No.** Program `HxVw6HtWqKnoapmHwCcF7tnwbkdQRJ2V4AQUQvFB857g` returns `null` from `getAccountInfo` on both mainnet and devnet. Its README says the devnet spec "is not achievable" and tests replay mainnet routes locally. The app's buy flow is "simulated in the UI" (reported). | Closest mechanism. **Prices "arrive as instruction arguments, computed off chain"** (README L32), so NAV comes from the caller. USDC-only redeem. | README grep and both RPC reads: **yes** |
| 2 | **Symmetry**, program `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate` ([docs](https://docs.symmetry.fi/llms-full.txt)) | Yes: permissionless vaults of up to 100 tokens, supports Token-2022, in-kind withdrawal, prices from Pyth or Raydium CLMM/CPMM | Live on mainnet | **Latent competitor.** Anyone can create this basket there today. It already holds xStocks (NVDAx), which carry permanent delegate, pausable and scaled UI but no transfer fee. **Whether it handles transfer fees is unverified.** | `getProgramAccounts` count = **73**: **yes**. "0 reference a PreStocks mint" is reported. |
| 3 | **Indexify, "Pre IPO Technology Portfolio"** (listed as "Index" in PreStocks' ecosystem) | **No token.** Each constituent is bought into the user's own wallet ([FAQ](https://howto.indexify.finance/faqs)). 1% platform fee plus up to 0.5% creator fee. | Live since 2025-12-16 (reported) | Same user promise, different mechanism. About $3,065 TVL, 22 investors (reported). | Their API answers POST only. My first 200 stacks did not include it: **not independently confirmed** |
| 4 | ShalyX/synthabasket (Stocklana, devnet) | Yes, but uses legacy `anchor_spl::token`, so it **cannot hold Token-2022 PreStocks**; uses mirror mints; mixes PreStocks and Tessera | devnet `4BLhUEXX…qstA` | Low | reported |
| 5 | Penivera/stocklanda "StockForge" | In-kind mint/redeem; **never checks what the vault received**, so it is short 1% under PreStocks fees | localnet | Low | reported ([mint_basket.rs#L85-L105](https://github.com/Penivera/stocklanda/blob/dee31709fdbf726a3d365499c324a91e70b26000/stockforge/programs/stockforge/src/instructions/mint_basket.rs#L85-L105)) |
| 6–7 | danielamodu/stockweave, MallorcaBCDays/stocklana-baskets | Mirror tokens or USDC 1:1; **not backed by PreStocks** | devnet | Low | reported |
| 8 | Glider, Avo (PreStocks ecosystem "Index") | No token; per-user wallets | live | Low | reported |
| 9 | aralroca/prestocks-pulse "PRE8" | **Price index only**, off-chain, valuation-weighted ([metrics.ts#L51-L60](https://github.com/aralroca/prestocks-pulse/blob/21775a8984fa392b55a1a920a30e00386ac1db6a/src/metrics.ts#L51-L60)) | no program | Not a product | reported |

**Coverage gaps.** Stocklana's gallery is hidden until 25 Sep 4pm ET (231 submissions). Colosseum Arena needs a login. X was not searchable.

**Verdict.** No working, well-executed, deployed version exists. **Differentiation has to be concrete:**

1. It is actually deployed, with real mainnet backing.
2. Mint and redeem are priced from the vault's composition, not from caller-supplied prices (unlike #1).
3. It handles PreStocks fees correctly (unlike #5).
4. It handles lifecycle events such as SpaceX's expiry.
5. It offers in-kind redemption as an exit that can't be blocked, alongside USDC.

Symmetry could close the gap overnight if someone creates a PreStocks basket there. Transfer-fee support is the likely obstacle; checking it is a Phase 1 item.

---

## Q2: Does the transfer fee make this pointless?

### Live round-trip cost of doing it yourself

**Method.** For each leg, quote USDC → mint (basket ÷ 8), then quote selling the exact amount received back to USDC. Source: `lite-api.jup.ag/swap/v1/quote` with `excludeDexes=Manifest`. Manifest is excluded because its quotes ignore the fee (see Q3), and the non-Manifest quotes were checked against simulated delivery to within ±0.074%. Run at 2026-09-24 ~15:50 UTC; a second full run minutes later agreed to within 0.1 percentage points.

| Basket | $10 | $100 | $1,000 | $10,000 | $50,000 |
|---|---|---|---|---|---|
| Returned after buy-all-then-sell-all | $9.75 | $97.24 | $967.50 | $9,605.43 | $46,529.13 |
| **Round-trip cost** | **2.53%** | **2.76%** | **3.25%** | **3.95%** | **6.94%** |
| …of which the two transfer fees | 1.99% | 1.99% | 1.99% | 1.99% | 1.99% |
| Worst leg | NEURALINK 3.5% | NEURALINK 3.7% | NEURALINK 4.7% | FIGUREAI 5.5% | **SPACEX 18.4%** |

At $50k, the ANDURIL leg first failed with "Pool has not been updated in a while" and succeeded on retry.

### What the index adds or removes

| Path | Transfer-fee hops (1% each) | Round trip vs doing it yourself |
|---|---|---|
| **Doing it yourself:** pool → user wallet, later user → pool | 2 | baseline (table above) |
| **Index, program swaps straight into and out of the vault** (vault PDA is taker and destination) | 2 (pool → vault, vault → pool) | **Same.** Plus program transaction fees; no saving |
| Index with in-kind redeem, then the user sells | 3 (pool → vault → user → pool) | **+1%** |
| Index where swaps land in the user's wallet and are then deposited in-kind | 3–4 | **+1% to +2%** |
| In-kind deposit of tokens the user already holds, and in-kind redeem | 2 (user → vault → user) | **About 2% just to wrap and unwrap**; only sensible for arbitrageurs |
| **Secondary market in the index token** (plain SPL token, no transfer fee) | **0** | Only the index pool's spread and LP fee. **Only this path beats doing it yourself.** |

**Other real differences, measured:**

- **Account rent.** Doing it yourself needs 8 PreStocks accounts: 8 × 0.00162052 = 0.0130 SOL, which is **$1.50** at SOL $116.04 (Jupiter price v3, block 450074899). That is **15% of a $10 ticket** locked up, refundable on close. The index needs one account: plain SPL 165 bytes = 0.00149 SOL ($0.17).
- **Signatures.** Doing it yourself takes 8 swaps; the index takes 2 transactions under one approval (Q3).

**Verdict.** Say it plainly: **minting and redeeming through the index is never cheaper than buying the eight directly.** At best it costs the same, and only if swaps land straight in the vault and redemption sells straight from it.

The reason to exist is:
1. a single transferable position, fee-free once it is outside PreStocks' transfer path;
2. a secondary market where most users never mint or redeem;
3. composability, since a fee-free token can be used where the underlyings can't. The previous report found Kamino rejects any mint with a non-zero transfer fee.

**Costs of relying on a secondary market:**

- **Seed liquidity.** Someone has to provide it.
- **Arbitrage band.** Arbitrageurs keep the index price within roughly one side of the round-trip cost of NAV: about ±1.3–2% at $1k–$10k (half the round-trip figures above).
- **Issuer risk.** A fee-free wrapper routes around PreStocks' fee income. PreStocks sponsors the bounty but also controls pause and seizure through a 2-of-7 multisig. **Their reaction is unverified and is a real risk.**

---

## Q3: How a user actually gets in

### Hard limits (live feature-gate reads, slot 450075021)

- **Account locks: 64.** `increase_tx_account_lock_limit` (`9LZdXeKGeBV6hRLdxS1rHbHoEUsKqesCC2ZAPTPKJAbK`) has an empty account, so it is **not active**.
- **v1 transactions** (4,096 bytes, **no lookup tables**, 64 inline accounts): `enable_tx_v1` (`txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`) is **active since slot 447120000**.
- **CPI size restriction loosened:** `GDH5TVdbTPUpRnXaRyQqiKUa7uZAbZ28Q2N9bhbKoMLm` is **active since slot 312768000**. Jupiter recommends CPI since January 2025 ([docs](https://developers.jup.ag/docs/swap/v1/build-swap-transaction), reported).
- **CPI nesting: 4 levels.** `raise_cpi_nesting_limit_to_8` (`6TkHkRmP7JZy1fdM6fg5uXn76wChQBWGokHBJzrLB3mj`) is **absent**. The chain program → Jupiter → AMM → Token-2022 uses exactly 4. **Not yet tested through a real program:** routes whose AMM CPIs further could exceed the limit.
- **Per-transaction compute: 1.4M CU.** Instruction trace length: 64 (Agave v4.3.0 source, reported).
- **Jupiter API.** The v1 Swap API is superseded by **v2 `/build`**, which returns raw instructions and lookup tables and is the documented CPI path (reported). **Proven:** `api.jup.ag/swap/v2/build` accepts an off-curve PDA (`BtY3Q8VhpSCLZ3Frkp3gpCrQzPFfaABcZagimJrudzdX`) as `taker` and returns HTTP 200 with the PDA as signer (my own call).

### Measured per leg (v2 `/build`, $125 legs; simulated with taker `H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS`, a USDC-holding wallet)

| Leg | Compute (CU) | Transaction bytes | Accounts | Quote vs delivered (default routing) | Quote vs delivered (`excludeDexes=Manifest`) |
|---|---|---|---|---|---|
| ANDURIL | 187,878 | 744 | 37 | **−1.017%** (via Manifest) | −0.000% |
| ANTHROPIC | 99,749 | 665 | 27 | **−1.020%** (via Manifest) | 0.000% |
| FIGUREAI | 43,163 | 490 | 18 | **−1.000%** (Manifest) | 0.000% |
| KALSHI | 42,280 | 490 | 18 | **−1.000%** (Manifest) | +0.002% |
| NEURALINK | 49,671 | 490 | 18 | **−1.000%** (Manifest) | 0.000% |
| OPENAI | 44,087 | 490 | 18 | **−1.000%** (Manifest) | −0.074% |
| POLYMARKET | 46,340 | 490 | 18 | **−1.404%** (Manifest) | −0.072% |
| SPACEX | 114,386 | 565 | 22 | 0.000% (Meteora DLMM) | 0.000% |

Default-routing runs were at slots 450076107–450076185; the Manifest-excluded runs at 450076568–450076641.

**Jupiter's Manifest quotes still ignore the 1% fee in v2.** Worse, the over-quote pulls Jupiter's router toward Manifest. In 5 of 8 legs the non-Manifest route actually delivered more:

| Leg | Delivery gap, Manifest vs non-Manifest route |
|---|---|
| FIGUREAI | −0.85% |
| POLYMARKET | −0.38% |
| ANDURIL | −0.25% |
| KALSHI | −0.10% |
| ANTHROPIC | −0.02% |

Manifest was genuinely better for NEURALINK (+0.28%) and OPENAI (+0.20%). The two runs are about 3 minutes apart, so some of the gap is market movement.

**Design consequence.** The program must set its own minimum-output check on the **vault's measured balance change**, not trust Jupiter's `otherAmountThreshold`. If it trusts Jupiter, it either reverts at slippage settings below about 1% or accepts the hidden 1%.

### Packing legs into one transaction (proven by simulation; slots around 450076700)

| `maxAccounts` | 2 legs | 3 | 4 | 5 | 6+ |
|---|---|---|---|---|---|
| 64 (default) | **too large** (66 accounts, serialization overflow) | too large | too large | too large | too large |
| 20 | 755 B, 30 accounts, 136,905 CU ✓ | 906 B ✓ | 1,056 B, 45 accounts, 222,048 CU ✓ | **1,206 B, 52 accounts, 271,569 CU ✓** | too large |

**Price cost of `maxAccounts=20`**, compared with 64 (`/build`, same minute):

| Leg | Quoted difference at 20 vs 64 | Is it real? |
|---|---|---|
| ANTHROPIC buy | −1.0% | Mostly not: the 64-account route ends in Manifest, whose quote is ~1% too high |
| ANDURIL buy | −0.89% | Mostly not: the 64-account route passes through Manifest |
| ANTHROPIC sell | −1.3% | Partly: the 64-account route starts in Manifest |
| KALSHI sell | **−2.1%** | **Real:** no Manifest in the 64-account route |
| Most other legs | unchanged | — |

`maxAccounts=30` recovers the KALSHI loss to −0.01% at 17–29 accounts per leg. **Use about 30, not 20,** and pack 3–4 legs per transaction.

### Options

| Option | Transactions per deposit | Atomic? | Verdict |
|---|---|---|---|
| Program CPIs 8 Jupiter swaps in one transaction | 1 | yes | **Impossible:** account and size limits above |
| **Program CPIs Jupiter, 4 legs per transaction, deposit ticket PDA** | **2** (+1 the first time, to create the user's index-token account) | Per transaction. A ticket escrows the USDC and records each leg's measured balance change; shares are minted when all 8 legs have landed; unfilled legs refund USDC. A Jito bundle (≤5 transactions, atomic; reported) can make both transactions all-or-nothing. | **Recommended** |
| Off-chain routing: the frontend swaps into vault accounts, then the program credits | 2–3 | no | Can't attribute deposits safely across transactions. **Can't do redemption at all:** the vault PDA can't sign a top-level swap, so selling from the vault needs CPI anyway. |
| In-kind only | 8 transfers in 1 transaction | yes | Costs 1% per hop on top of the user's own purchase (Q2). Keep it as the **arbitrageur and emergency path**, not the main flow. |

**Cost a user faces for the recommended path:**

- **Network fees:** 2 transactions × 5,000 lamports base = 0.00001 SOL, plus priority fees (**estimate** 0.00005–0.0005 SOL; not measured).
- **Rent:** ticket rent refunded at finalize; index-token account 0.00149 SOL once.
- **Market cost:** the Q2 round-trip table (entry side ≈ half).

**One approval for 2 transactions** relies on wallets' `signAllTransactions` / `signAndSendAllTransactions`. Reported from docs; **not verified in a real browser.**

---

## Q4: Custody

### Can a program PDA create and hold an account for each mint? Proven, all 8

**Setup.** Vault PDA = `findProgramAddress(["vault"], Bskt1111111111111111111111111111111111111111)` = `BtY3Q8VhpSCLZ3Frkp3gpCrQzPFfaABcZagimJrudzdX` (bump 251, `isOnCurve` false). Each transaction ran `CreateAssociatedTokenAccountIdempotent` (Token-2022) followed by `TransferChecked` of 10,000,000 raw from a real holder. `simulateTransaction` returned the resulting account (jsonParsed). A second simulation appended `HarvestWithheldTokensToMint`.

| Mint | Slot | Vault account | Owner | Received | Withheld | After harvest | Space / rent | CU |
|---|---|---|---|---|---|---|---|---|
| ANDURIL | 450071671 | `DgF8z9dy…gAyX` | PDA | 9,900,000 | 100,000 | 0 | 191 B / 0.00162 SOL | 24,663 |
| ANTHROPIC | 450071994 | `3JeTpMhu…uuV` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 24,663 |
| FIGUREAI | 450072307 | `5CfiW67L…Q3E` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 26,163 |
| KALSHI | 450072596 | `HGzQUDH7…RTAp` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 26,163 |
| NEURALINK | 450072883 | `3xuurxwv…Vv6c` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 24,663 |
| OPENAI | 450073168 | `DKH9TiDV…7htq` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 24,663 |
| POLYMARKET | 450073465 | `BBomQF3K…mJwkM` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 24,663 |
| SPACEX | 450073759 | `3K6xFwZ2…ocq1` | PDA | 9,900,000 | 100,000 | 0 | 191 / 0.00162 | 26,163 |

Every account was created with `immutableOwner`, `transferFeeAmount`, `transferHookAccount` and `pausableAccount`, in state `initialized`. Harvest succeeded with no signer, so a vault can always be cleared before it is closed.

**Not proven on mainnet:** a transfer *out* of the vault. The PDA can only sign through a deployed program. The devnet proofs below cover the extension behaviour.

### What the extensions mean for a vault holding user assets (real devnet transactions)

**Fixture mint** `5vcYoRJcfzk8Xv5spWusaxLBJcp6p99GSvk7f4x2wi4t`, with the same extension set as mainnet (see Q8). Vault `B2KcUV5LqZnVQ5krqzcS6K6RBM6SeapGVJrjdFtiAFqB` is owned by the same PDA and funded with 10 tokens: 9.9 received, 0.1 withheld (tx `3R35LKHG…ZK9v`).

1. **Permanent delegate can take from the vault without the vault signing.**
   - `spl-token burn` signed only by the delegate took the vault from **9.9 to 7.4** (tx `2ouUBzUZniEC3BYJzBbFQXRvjR4o3HF23FVioDutXfKd8XQScHHNLDBTaCWgNWEzE7w5SpS4t3zPimCQTfRiCG63`).
   - On mainnet the delegate is the 2-of-7 multisig above. The previous report scanned 963 of its transactions (March to September 2026) and found **no use** of the delegate against holders.
   - **Design:** the vault's actual balance is the truth. Shares are claims on whatever is there. A shortfall reduces every holder's claim pro-rata; no one is made whole by later depositors. The UI shows the balance against the last recorded balance and flags any drop that wasn't a redemption.
2. **Pause blocks every movement of that mint.**
   - `spl-token pause` (tx `2ttKtuiUFcPSV42D7XcsdHXz4H7TXMqyypwesmdAvu7zvzXz5Wbv4ac38ZkN3RHxbr9XmweA9Gvu5fZF7d3fbzcf`), then a transfer into the vault failed: custom program error **0x43**, which is `MintPaused` (variant 67 of `TokenError` in the spl-token-2022 8.0.1 source). Resumed afterwards.
   - **Redemption mid-position:** any path that moves the paused mint fails: USDC redeem, in-kind redeem, and deposits. If redemption requires all 8 legs at once, **one paused mint freezes the whole basket.**
   - **Design:** deposits refuse outright while any mint is paused. Redemption becomes **partial**: burn shares, pay the 7 unpaused legs now, and record a per-user claim on the paused leg that can be settled after resume. The claim is a small PDA holding the raw amount owed.
3. **A frozen default state makes new vault accounts unusable.**
   - `update-default-account-state frozen`, then a fresh vault account for a second PDA was created frozen, and the deposit failed with **0x11**, which is `AccountFrozen`. Reverted afterwards.
   - **Design:** create all 8 vault accounts at initialisation and never re-create them. Check `defaultAccountState` and each vault's `state` on every call, and refuse if anything is frozen.
4. **Transfer hook** (currently null). If the issuer attaches a program, every CPI transfer then needs extra accounts. **Refuse** if any mint's `transferHook.programId` is not null, as the brief requires.

The fixture was restored and verified at the end: `paused:false`, default state `initialized`.

---

## Q5: Pricing

### Every available source, per mint (poll every ~60 s, 12 snapshots, 16:00:48–16:12:20 UTC, slots 450076724–450079326)

| Source | Coverage | Freshness (measured) | Units | Usable for |
|---|---|---|---|---|
| **PreStocks `markPrice`** (`prestocks.com/api/prestocks`) | all 8 | Values changed 3 times in 11 minutes, i.e. **about every 5 minutes**. SPACEX changed 9 times in 11 minutes because it tracks the listed stock. Headers: `cache-control: max-age=0`, **no timestamp or last-modified header**. Jupiter's `stockData.updatedAt` mirrors it (age 40–291 s). | USD per UI token | **Display only.** "An average of reputable offchain secondary market data sources" ([PreStocks on X](https://x.com/PreStocks/status/1984156823633740090), reported). Not tradable and not verifiable on-chain. |
| **PreStocks `tokenPrice`** | all 8 | Same as Jupiter's last-trade price: moves in step, 0–9 changes in 11 minutes | USD per UI token | Display |
| **Jupiter price v3 `usdPrice`** (`lite-api.jup.ag/price/v3`) | all 8 | "Last swapped price" (reported). Age by `blockId` against current slot: median / max. **FIGUREAI 75.7 / 83.6 min**; NEURALINK 10.0 / 28.1; SPACEX 3.4 / 21.5; KALSHI 3.1 / 8.3; ANDURIL 1.6 / 5.9; OPENAI 0.5 / 2.3; ANTHROPIC and POLYMARKET 0.3 / ~2. | Per UI token. `scaledUiConfig.usdPricePrescaled` = per raw unit. | Display, with its age shown |
| **GeckoTerminal / DexScreener** | all 8 | `max-age=30` (reported) | **Per raw unit, before the multiplier:** SPACEX 595.7 vs 117 × 5; OPENAI 1970 vs 1342 × 1.486 | Only with explicit normalisation; mixing sources without it values SPACEX 5× wrong |
| **Pyth** | **OpenAI** `Equity.Index.OPENAI/USD` (`96d4bb23…c483`), **Anthropic** `Equity.Index.ANTHROPIC/USD` (`5da511a7…689d`), SPCX / SPCXx feeds. **None for the other 5.** | Catalog confirmed (HTTP 200). **Latest price returns HTTP 401: Hermes needs an API key**, so I couldn't read a value. Pyth calls these "informational, indicative… may be based on few or stale data points", `min_publishers: 1` (reported). | USD per company share, not per token | Not for mint or redeem. Useful as a sanity band for 2 of 8 names. |
| **Switchboard / Chainlink / RedStone** | none found | — | — | — (reported, search only) |
| **Executable quotes** (Jupiter, fee-inclusive) | all 8 | Live at request time | USDC per UI token at a given size | **The only value a holder can actually realise** |

### How far the sources disagree (executable quotes ~15:50, snapshot 16:09)

| Mint | Ask / bid at $125 (incl. both 1% fees) | Spread | Mid vs last trade | **Mid vs mark** |
|---|---|---|---|---|
| ANDURIL | 161.94 / 156.64 | 3.4% | +0.6% | +4.1% |
| ANTHROPIC | 1048.67 / 1024.83 | 2.3% | +0.9% | +0.1% |
| FIGUREAI | 179.11 / 172.12 | 4.1% | −0.8% | −2.9% |
| KALSHI | 891.05 / 869.36 | 2.5% | −0.3% | −0.1% |
| NEURALINK | 448.67 / 427.71 | 4.9% | +1.1% | **+30.2%** |
| OPENAI | 1356.07 / 1322.48 | 2.5% | +1.3% | **+30.9%** |
| POLYMARKET | 149.99 / 145.03 | 3.4% | −2.8% | +2.2% |
| SPACEX | 121.48 / 117.03 | 3.8% | +2.8% | **−19.6%** |

**The same $1,000 equal-weight basket, valued immediately after purchase:**

| Method | Value | vs paid |
|---|---|---|
| Mark | $952.39 | −4.8% |
| Last trade | $980.59 | −1.9% |
| **Executable liquidation** | **$967.50** | **−3.3%** |
| Naive raw balance × UI price (the multiplier bug) | $845.25 | −15.5% |

### Holdings with no route or huge price impact (depth ladder, `excludeDexes=Manifest`, ~16:15 UTC; round-trip % per leg)

| Leg | $1k | $5k | $10k | $25k | $50k | $100k |
|---|---|---|---|---|---|---|
| ANDURIL | 3.3 | 4.4 | 5.5 | 8.8 | 13.2 | 36.5 |
| ANTHROPIC | 2.2 | 2.3 | 2.3 | 2.3 | 2.7 | 3.3 |
| FIGUREAI | 5.7 | 8.5 | 10.4 | 15.7 | **49.6** | **52.1** |
| KALSHI | 2.8 | 3.8 | 4.1 | 5.1 | 8.4 | 29.3 |
| NEURALINK | 4.9 | 7.0 | 7.4 | 10.3 | **no route** | **no route** |
| OPENAI | 3.5 | 4.0 | 4.6 | 7.0 | 11.5 | **no route** |
| POLYMARKET | 3.0 | 4.9 | 5.7 | 7.4 | 11.3 | **99.99** |
| SPACEX | 4.7 | **17.6** | 19.5 | 22.7 | 29.8 | **no route** |

### Recommendation: price mint and redeem from the vault's own composition

- **Mint:** shares issued = `total_shares × min_i(Δvault_i / vault_i)`, where Δ is the **measured** raw balance change per mint.
  - Pro-rata "all-asset join"; no price enters the program.
  - Legs that overshoot the minimum ratio stay in the vault and accrue to all holders. That residual is bounded by the per-leg slippage limit and is disclosed.
  - The first deposit (empty vault) sets the composition from the chosen weights × prices at inception. This is a one-time bootstrap by the deployer, published with its source data.
- **Redeem:** burning `s` shares releases `s / total_shares × vault_i` of every leg. Each leg is either sold to USDC by CPI, with the **user's** minimum output checked against the measured USDC change, or delivered in-kind. In-kind is the exit that can't be blocked when routes fail.

**Why no oracle or "price":**
- None exists on-chain for 5 of 8 names.
- `markPrice` is off-chain, updates about every 5 minutes and sits up to 31% from tradable prices. Minting at mark would let anyone drain the vault through the gap: deposit whatever is cheapest on-market, redeem what mark overvalues.
- Last-trade prices are up to 84 minutes stale, and the pools are thin enough ($99k–$888k Jupiter-reported liquidity) to move cheaply.
- Pricing from composition means **the actor bears their own execution cost**. That is how ETF creation units work.

**When a leg has no route or excessive impact:**
- A USDC mint fails its minimum-output check, and the ticket refunds.
- A USDC redemption of that leg falls back to in-kind delivery.
- The UI caps order size at the largest size where every leg's quoted round trip is under a set limit, and shows that capacity. With a 10% limit, today's capacity is **about $1k per leg (about $8k per basket) with SPACEX**, because SPACEX is 17.6% at $5k. **Without SPACEX it is about $5k per leg (about $35k per 7-leg basket)**, because FIGUREAI is 8.5% at $5k and 10.4% at $10k.

**How the price is stated honestly in the product:**
- **Headline: "If you redeemed now: $X"** — the sum of live fee-inclusive sell quotes for *this user's* share at *their* size.
- **Below it:** "Last-trade value: $Y (oldest price N min ago)" and "PreStocks reference value: $Z — off-chain secondary-market estimate, not tradable".
- Show the per-leg premium to mark and each price's age.
- **Limits stated in the UI:** no oracle; thin markets; the issuer can pause or seize; SpaceX expiry; values are raw-balance × per-raw-unit price, independent of display multipliers.

---

## Q6: Weights

**What PreStocks publishes.** Per mint, `markValuation`, `impliedValuation`, `markPrice`, `tokenPrice` and `supply` (API snapshot 16:01:50 UTC). The valuations are company valuations derived from mark × implied share count ([prestocks-pulse fixtures](https://github.com/aralroca/prestocks-pulse/blob/21775a8984fa392b55a1a920a30e00386ac1db6a/test/fixtures.ts), reported). They are **PreStocks' own secondary-market estimates, not audited market caps.** I did not cross-check them against funding rounds. Examples: Anthropic $1,696B, SpaceX $1,949B.

| Mint | Mark weight | Implied weight | Equal weight | Jupiter liquidity | On-chain token market cap |
|---|---|---|---|---|---|
| SPACEX | **37.5%** | 29.7% | 12.5% | $114k | $5.12M |
| ANTHROPIC | **32.6%** | 32.6% | 12.5% | $836k | $7.58M |
| OPENAI | **24.4%** | 31.7% | 12.5% | $888k | $3.74M |
| ANDURIL | 2.6% | 2.7% | 12.5% | $434k | $1.87M |
| NEURALINK | 1.2% | 1.6% | 12.5% | $247k | $1.12M |
| FIGUREAI | 0.8% | 0.7% | 12.5% | $99k | $0.53M |
| KALSHI | 0.6% | 0.6% | 12.5% | $100k | $0.79M |
| POLYMARKET | 0.3% | 0.3% | 12.5% | $174k | $0.72M |

- **Cap-weighting is a three-stock product.** 94.5% sits in SpaceX, Anthropic and OpenAI, and five names get under 3% each. It is also capacity-mismatched: SPACEX carries the largest weight but has only $114k of liquidity and a 17.6% round trip at $5k.
- **Equal weight** is the honest "basket of eight", but it is capped by the thinnest legs: FIGUREAI 10.4% and SPACEX 19.5% round trip at $10k per leg.

**SpaceX is no longer pre-IPO.**
- `https://www.prestocks.com/spacex`, fetched today, says: "SpaceX has gone public! SpaceX PreStocks tokens must be swapped into $SPCXx or any other token before 11:59pm UTC on 12 March 2027, or they will expire worthless." None of the other seven pages carries such a notice.
- **"Swapped" means a market trade, not issuer redemption at par.** SPACEX PreStock is at **$117.10** against SPCXx (`Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8`) at **$148.31** (Jupiter price v3, blocks 450074444 and 450076942). That is a 21% discount.
- SPCXx is itself Token-2022, with permanent delegate, pausable and scaled UI but **no transfer fee** (read at slot 450076916).

**Fixed weights, no rebalancing: what it means for a holder.**
- The vault holds fixed **raw quantities**, so value weights drift with relative performance. After a year the basket is overweight whatever rose, and the holder owns that drift.
- Display multipliers don't affect raw quantities; that is correct.
- **"No rebalancing" can't hold for SPACEX.** Before 12 Mar 2027 someone must sell it or swap it into SPCXx, or that leg goes to zero. That is a governance action.
- **Options for your decision:**
  - (a) **Exclude SPACEX from v1**: seven genuinely pre-IPO names, no expiry inside a year. Recommended.
  - (b) Keep it, with a published conversion rule: the program swaps SPACEX to SPCXx after a set date, triggered permissionlessly.
- The same rule will be needed for any constituent that IPOs, which is the whole thesis of the product.

---

## Q7: What wins at World's Fair

Sources: [rules PDF](https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf) §5–8, §14, [FAQ](https://colosseum.com/hackathon), and Colosseum blog posts ([how to win](https://blog.colosseum.com/how-to-win-a-colosseum-hackathon/), [perfecting your submission](https://blog.colosseum.com/perfecting-your-hackathon-submission/)). All reported via sub-agent; the rules PDF and page were also read in the previous phase.

- **Deadline:** 6:00am PT 14 Sep to **11:59pm PT 12 Oct 2026.** Winners by 5 Dec.
- **Judging criteria (rules §8, unweighted):**
  1. Functionality and code quality
  2. Potential impact (market size, ecosystem effect)
  3. Novelty
  4. UX
  5. Open source and composability
  6. Business plan and team
- The FAQ adds founder–market fit, insight, execution speed, communication, viability and traction.
- **Submission requirements:**
  - GitHub repo (private allowed if shared with hackathon@colosseum.com)
  - **Pitch video of 2–3 minutes**, "the most important element"
  - **Product demo of ≤3 minutes**
  - Go-to-market and demand validation
  - Weekly 1-minute updates, recommended
  - No deployment requirement stated
  - Prior work must be disclosed; only work inside the window is judged
- **Prizes:**
  - Grand champion: $30k
  - Next 20 teams: $15k each
  - Solana track: $100k across 10 projects
  - Public Goods: $5k; University: $5k
  - Accelerator consideration: $250k pre-seed
  - There is **no RWA track**; Frontier and Cypherpunk winners included baskets (Cesto) and private-equity tokenisation (Bore.fi, ODL), which is precedent.

| Criterion | This idea |
|---|---|
| Functionality | **Strong if** the demo is real mainnet mint, NAV and redeem against real PreStocks, handling fee, pause and multiplier. That is exactly what competitors haven't shipped. |
| UX | **Strong:** "$10, one approval, one token" against 8 swaps and 8 accounts. The honest price panel is a differentiator. |
| Composability | **Strong:** a fee-free share token over fee-bearing assets. |
| Novelty | **Weak–medium:** baskets are common (Symmetry, Cesto, Indexify, many Stocklana entries). Novelty has to come from doing the hard parts correctly, not the concept. |
| Impact / market | **Weak:** the eight tokens total about $21.5M on-chain market cap and about $3.8M of liquidity. The pitch has to be about the category (private markets on-chain), not today's size. |
| Business plan | **Weak–medium:** a mint/redeem fee on thin flow. Dependent on one issuer, which controls pause and seizure through a 2-of-7 multisig and whose SPV transfers Anthropic and OpenAI have called invalid ([CoinDesk, 13 May 2026](https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid), reported). |

---

## Q8: Environment and cost

- **Devnet availability:** `getMultipleAccounts` on devnet at slot **503544362** returns null for all 8 mints. Fixtures are required.
- **Tooling, proven:** one `spl-token-cli 5.5.0` invocation reproduced the full extension set:

  ```
  spl-token create-token --program-2022 --decimals 9 --transfer-fee-basis-points 100 --transfer-fee-maximum-fee 18446744073.709551615 --enable-permanent-delegate --enable-pause --enable-freeze --default-account-state initialized --enable-transfer-hook --ui-amount-multiplier 1 --enable-metadata --enable-confidential-transfers manual
  spl-token initialize-metadata …
  ```

  - Fixture `5vcYoRJcfzk8Xv5spWusaxLBJcp6p99GSvk7f4x2wi4t` (tx `4h7rrgve…KgSh`), read back at devnet slot 503544653.
  - **Extension-set diff against mainnet ANTHROPIC: empty in both directions.** `transferHook.programId` is null with a live authority, matching mainnet. Size is 891 vs 911 bytes; the difference is metadata string length.
  - `update-ui-amount-multiplier`, `set-transfer-fee`, `pause`/`resume` and `update-default-account-state` exist for scripted issuer events. The last three were exercised in Q4.
- **Devnet costs:**
  - One fixture mint with metadata: **0.00522 SOL** (balance 3.344959562 → 3.339738042).
  - Eight fixtures plus accounts: about 0.06 SOL.
  - Program deploy rent: 300 KB = 1.525 SOL, 500 KB = 2.541 SOL, 700 KB = 3.557 SOL. A temporary buffer of about the same size is needed during deploy; both are refundable.
  - The local devnet wallet `68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf` holds **3.3397 SOL**; enough for one deploy, a faucet top-up is needed for upgrades.
- **What devnet can't show:** no Jupiter, no PreStocks liquidity, no real routes. A devnet demo means mock pools or in-kind only. Intellihackz's README reached the same conclusion.
- **Convincing demo: mainnet with small real positions.** Costs at SOL = $116.04:

  | Item | SOL | USD |
  |---|---|---|
  | Program deploy rent (refundable) | 2.5–3.6 | $290–$415 |
  | 8 vault accounts | 0.013 | $1.50 |
  | Index mint + state | ~0.004 | $0.50 |
  | Seed basket | — | $100–$200 |
  | Round-trip cost of a $100 seed | — | ~2.8% |
  | Transaction fees | negligible | |

  - **Blocker:** this machine has no funded mainnet wallet (the local keypair holds 0 SOL). A mainnet deployer keypair and roughly 4–5 SOL plus $200 in USDC are needed. That is your decision.
  - Before mainnet, Phase 1 should test against **cloned mainnet state** locally (Surfpool or LiteSVM with cloned PreStocks mints and pools) so the CPI depth and route limits are proven without spending.

---

## Proposed agent split (for after Phase 0 approval)

**I agree the pricing design can't be parallelised.** More precisely, three things must be settled first, by one owner, because everything else reads or writes them:

1. **Share accounting and pricing spec:** the composition-based mint and redeem formula, rounding direction (always in the vault's favour), residual handling, the bootstrap rule, the partial-redemption claim for paused legs, and the SPACEX decision (Q6).
2. **On-chain interface:** account layouts, PDA seeds, instruction list and args, events, error codes. Fixed as an IDL plus a written layout document before anyone builds against it.
3. **NAV and quote API schema** that the frontend consumes: the three values, freshness, per-leg breakdown and capacity.

These are documents, not code, and fit in about 1–2 days.

**Then three agents, each with its own folder and branch:**

| Agent | Owns (folder / branch) | Builds | Depends on |
|---|---|---|---|
| **A: program** | `programs/` / `program` | Anchor program: vault, 8 vault accounts at init, deposit ticket, Jupiter CPI legs with measured-delta minimum output, finalize mint, redeem (USDC and in-kind), partial redemption on pause, guards (paused, non-null hook, frozen vault, fee read at the current epoch), harvest-before-close. Tests on LiteSVM/Surfpool with **cloned mainnet** mints and pools. | Spec 1 and 2 |
| **B: client and app** | `app/`, `sdk/` / `app` | Transaction builder (Jupiter v2 `/build`, `maxAccounts` tuning, `excludeDexes`, 4-leg packing, lookup tables, optional Jito bundle), wallet flow (one approval, two transactions), UI including the honest price panel. Browser test with a **fresh wallet**. | Interface 2 and 3; mocks the program until A ships |
| **C: data and ops** | `services/`, `scripts/` / `ops` | NAV service (three values, freshness, per-raw-unit normalisation), capacity calculator, issuer-change watcher (fee, multiplier, pause, hook, default state, multisig config), devnet fixtures and scripted issuer events, mainnet deploy runbook. | Interface 3; reads chain directly |

**Rules as you set them:**
- No shared files.
- Anything that changes the IDL or the NAV schema goes back to the spec owner.
- Findings across a boundary are reported, not fixed. Example: B finding Jupiter's Manifest mis-quote is reported to A, whose minimum-output logic depends on it.

**Where each agent's work counts as proven, not "tested locally":**
- **A:** a mainnet transaction that mints and redeems against real PreStocks.
- **B:** that flow completed in a real browser by a new wallet.
- **C:** NAV figures matched against live on-chain reads at a stated slot.

---

## Not verified in the time available

- **Symmetry:** transfer-fee handling, and "0 of 73 accounts reference PreStocks". I confirmed only the count of 73.
- **Indexify:** TVL and investor count. Its API didn't return the stack in the first 200 results.
- **Pyth:** actual values and confidence for the OpenAI and Anthropic feeds (HTTP 401 without a key).
- **CPI depth:** that Jupiter CPI from a real program stays within 4 levels for every route. Needs a deployed or cloned-state program.
- **Wallets:** one-approval signing of 2 transactions in Phantom or Solflare. Browser not tested.
- **Priority fees:** actual per-transaction cost; the range given is an estimate.
- **Mainnet transfer out of a PDA vault:** needs a deployed program. Devnet proofs cover the extension behaviour.
- **PreStocks' stance** on a fee-free wrapper over their tokens.
- **Stocklana gallery:** hidden until 25 Sep 4pm ET; re-check for new basket entries after.
