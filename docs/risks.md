# Risks we answer before anyone asks

Written 2026-09-25. Each claim is labelled **verified** (read live or checked against the primary text by the spec owner) or **reported** (from a research sub-agent, with its source).

---

## 1. PreStocks is raising the fee to 300 bps on all seven names

**Verified, live.**

- **What the chain shows.** `transferFeeConfig.newerTransferFee = 300 bps from epoch 1043` on every basket mint, read at mainnet slot 450110424.
- **Set-fee transactions,** all from the issuer multisig's vault `WV9P…Fti5Wc` on 2026-09-24:

  | Mint | Time (UTC) | Signature |
  |---|---|---|
  | FIGUREAI | 17:50 | `3kPL56XVmfLSPFv9hbKwcLTBCnHqChm8vANdZ3adV9Q5gaSoWvoPiSDSKGRkoNWb5hyWNEceCDDkLJ62MwtonUgP` |
  | NEURALINK | 17:54 | `38NvKxQ8askR7FqrZLj4doFDLK8Tatfpgaqu1Y9tsuKnhc9sZ366zkqGPwDNxj1nq43gMfuVw76injsHzbJMbEqY` |
  | KALSHI | 17:56 | `2kCnFhFK7zJL2mejcNU21SyVGGWbT4ggrsV7KFirGKYgkBjp5tiQtbhKxTNX2ghDipHUGXEvC3Kxvnz9Wgc1C6Vc` |
  | ANDURIL | 17:57 | `2FyJC4aNayfKdH2SzTBG6GK9s3AWEHxHNpf1HiPMdzVhRQCS4DCFX9cjofbL7vjDbx9bpEtozmSAregaYf619nUq` |
  | POLYMARKET | 18:06 | `43EW7SJspmdsvn56M2yRpCzYVKvEKdtCfkuARTrLPk1vcEtqyKNgHN6woA5XXcfbPckC4PbrDwQdyasCTZB6saTe` |
  | ANTHROPIC | 18:10 | `kZFHsxbxPBh2xSssiCjR7e5PPFhyCBhi8ou8bSoyjACAvk3nk2ZZCXn45r7zsMctcdL5qWzpAnRrc4niKMpn2wu` |
  | OPENAI | 18:11 | `2FxzQ66J7U1TUnrDpBRtay71uw5BKsA5EWWsTmGkL8s6R2daNcKSHrkw3YdsB9WVXkuoqcgtTvnEgs22iUM9H3mD` |

  The same batch set xAI to 0 bps (`VmoagJZj…`). SpaceX, which is not in the basket, stays at 100 bps.
- **Takes effect at epoch 1043, ≈ 2026-09-26 04:52 UTC.** That is about 35 hours after it was set. The estimate uses the measured 0.2657 s per slot over epoch 1041.
- **No public announcement found** (reported).
- **Third change in 16 days:** 0 → 50 bps (Sep 8), 50 → 100 bps (Sep 19), 100 → 300 bps (Sep 24).

**What it does to the product:**

- **Round-trip fees roughly triple.** At 300 bps, fees alone on a buy-then-sell round trip are `1 − 0.97 × 0.97` = **5.91%**, against 1.99% at 100 bps.
  - Adding the spread component measured on Sep 24 gives an estimated **≈ 6.5% at $10, ≈ 7.2% at $1k, ≈ 7.9% at $10k**.
  - That is arithmetic on measured spreads, not a new measurement. It must be re-measured after epoch 1043.
- **The accounting design is unaffected.** No fee is stored anywhere: every inflow is credited at its measured delta, and every payout's fee is borne by the recipient. This is the *fee change mid-position* scenario from spec 02, and it is about to happen on mainnet. Our fixture suite reproduces the same 100 → 300 bps change on devnet.
- **The honest pitch moves further from "cheap".** Minting and redeeming now costs about 6% in fees alone. The basket token's own secondary market, which is fee-free, becomes the only affordable way in and out for small holders. **That is exactly the part that routes around PreStocks' fee (section 2).**

---

## 2. Issuer stance: "Doesn't this route around PreStocks' fee income, and can't they pause or seize your vault?"

### The facts

- **Who controls the mints: a Squads v4 multisig, 2 of 7, time lock 0 (verified).** Multisig `53Ab3Rqx1a5uiV7qmsX4qbdbrqstVDpnH4LoJGfsZsU8`, decoded from its account (`docs/phase0.md`). Its vault holds mint, freeze, permanent-delegate, pause, fee, withdraw-withheld, hook, multiplier and metadata authority on every mint.
- **What their Terms of Service reserve.** Verified against the ToS text at `prestocks.notion.site/terms-of-service`:
  - **Wrapping and pooling happen without them:** tokens "may be listed, quoted, wrapped, bridged, pooled, lent against, used as collateral, or otherwise made available by any person on any venue at any time, without our involvement, knowledge, consent, or approval. We do not endorse … any such listing, venue, pool, wrapper, derivative, or integration."
  - **Fees apply to wrapping:** fees "may apply automatically to any and every transaction in a token — including each transfer, trade, deposit, withdrawal, wrap, unwrap, stake, unstake, bridge, mint, burn, or redemption — wherever and however that transaction occurs, including on third-party … liquidity pools, aggregators".
  - **Where fees go:** fees "may be harvested, swept, withdrawn, or claimed by us or our designees at any time and applied for our own account unless we expressly state otherwise in writing."
  - **Enforcement:** they may "restrict, suspend, disable, deprecate, delist, pause, wind down, compulsorily redeem, or permanently discontinue any token, feature, functionality, market, pool, integration, or Service". They may also "freeze … recover, claw back, or compulsorily transfer or re-assign any token; … burn".
- **What they invite:**
  - **The bounty:** "new ways to trade or use them through derivatives or DeFi integrations … lending/collateral, structured products" ([Stocklana](https://hackathons.solana.com/hackathons/stocklana), verified in Phase 0).
  - **The FAQ:** holders can "use them to build new structured products" ([prestocks.com/faq](https://prestocks.com/faq), reported).
  - **The ecosystem page** lists an **Index** category with three entries (Indexify, Glider, Avo), plus leverage and liquidity venues (reported, from `prestocks.com/_next/static/chunks/985-f609a54b5bab08a7.js`).
- **Track record: the permanent delegate has been used to empty holders' accounts (verified).**
  - On **2025-09-19**, the multisig vault `WV9P…`, which is the permanent delegate, signed `transferChecked` out of **29 token accounts owned by other wallets**, across seven transactions. **Every one was emptied to exactly zero.**
  - Tokens moved: XAI 26.86, SPACEX 3.66, ANDURIL 1.75, OPENAI 0.69, ANTHROPIC 0.20. They went mostly to one account owned by `CTSxn7dte66zxZT61XDHMYM6stypJySBbQF5tpnjgvBz`.
  - No memo explains why. It may have been a compliance sweep or launch-period cleanup, but **the reason is unknown and we don't guess it**.
  - Example transactions: `2smHrk8UHqyZgqWS5ozisWGitWFMPv6mmA2VNnVSv45xrEU7uMDXycKMrSbE6YNapp9YF6Xd1ESt4aZwH6QxvkHB` (7 accounts) and `3Umb9MA4U4LzWdpuT24qLDUdAsvn7UXgwSwgPtd39UVEDFHVnZJWY7cTVHew6Q3rhC11zWvBPQvkPEsE1WaWiY7y` (6 accounts).
  - How this was found: authority and source owner were read from each transaction's parsed instructions and `preTokenBalances`.
  - Since then, no delegate use against holders was found in the 963 transactions from March to September 2026 (Phase 0).
  - In roughly 714 of the multisig's last 1,000 transactions there are **no Pause and no FreezeAccount instructions** (reported, partial scan).
- **Fee revenue.** A PreStocks post on Sep 8 says fee revenue goes "towards more support for PreStocks builders, more liquidity, and more supply" ([x.com/PreStocks/status/2097379481975759256](https://x.com/PreStocks/status/2097379481975759256), reported). The ecosystem page says RevShare distributes fees to holders. The ToS says fees are applied "for our own account".
  - A sampled on-chain trail (reported, inference) shows withheld fees swept to a multisig-controlled vault and then a trading wallet, with **no pro-rata holder distribution seen**.
  - **We assume the vault receives no fee income.** The earlier statement in `docs/phase0.md` that fees go to holders via RevShare is superseded by this.

### Our answer

**Yes to both, and the design assumes it.**

1. **The fee.** Every deposit into and redemption out of the basket pays PreStocks' fee on every leg, now 300 bps. Their ToS explicitly covers wraps. What skips the fee is trading the basket token itself. That is a real diversion of fee income, and we don't pretend otherwise. Two reasons it is still a reasonable thing to build:
   - It is the product category their own bounty invites ("structured products", "DeFi integrations").
   - It routes demand *into* PreStocks, because every new basket unit buys seven PreStocks tokens and pays their fee.
2. **Pause and seizure.** Yes: a 2-of-7 multisig with no time lock can pause any leg or take tokens out of our vault. That is the reason this basket exists.
   - Symmetry, the incumbent, stops paying out *entirely* when one leg is paused or seized. Proven in `evidence/symmetry-fork/`.
   - The seizure power isn't hypothetical: it emptied 29 holder accounts on 2025-09-19 (above).
   - Our basket keeps paying every leg the issuer didn't touch. It turns the touched leg into a claim, and it shares any seizure pro rata among holders, visibly.
   - **We don't claim protection from the issuer. We claim that the basket degrades per name instead of failing whole.**

**Options that need your decision (not adopted):**
- Ask PreStocks for a written acknowledgement. Their ToS allows written exceptions ("unless we expressly state otherwise in writing").
- Add a basket-level fee on mint and redeem routed to PreStocks' fee wallet or a builder share.
- Geofence US persons and PreStocks' prohibited jurisdictions in the app.

**Adopted in the specs:**
- The fee is read live and never assumed.
- Per-leg availability checks and claims.
- Balance-as-truth accounting.
- Disclosure of every issuer power on every value screen (spec 03 `/v1/issuer`).

---

## 3. The SPV dispute: OpenAI and Anthropic say the underlying transfers are void

### The facts

- **Anthropic (verified, primary and press).** "We do not permit special purpose vehicles to acquire Anthropic stock and any transfer of shares to an SPV are void under our transfer restrictions."
  - It says third parties selling via "direct sales, forward contracts, tokenized securities, or other mechanisms" are "likely either engaged in fraud or offering an investment that may have no value due to our transfer restrictions".
  - Sources: [CoinDesk, 13 May 2026](https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid); Anthropic's support article ([support.claude.com](https://support.claude.com/en/articles/13704655-unauthorized-anthropic-stock-sales-and-investment-scams), reported, which names several platforms but not PreStocks).
- **OpenAI (reported).** Equity cannot be "directly or indirectly transferred" without OpenAI's written consent, and an unauthorized sale "will not be recognized and carry no economic value". Sources: [OpenAI policy page](https://openai.com/policies/unauthorized-openai-equity-transactions/), which returned 403 to the agent, and CoinDesk and [The Block](https://www.theblock.co/post/401088/anthropic-openai-tokenized-prestocks-plunge).
- **Market reaction.** The ANTHROPIC PreStock fell 34% and OPENAI 39% over seven days (CoinDesk, verified).
- **PreStocks' response: none found.** CoinDesk, The Block and crypto.news report no comment (reported). CoinDesk also reports that PreStocks had promised attestation reports and had not published them (verified).
- **What a PreStock legally is.** Verified against the ToS: "bearer digital tokens that reference economic exposure to designated pre-IPO companies".
  - The risk factors list "refused consent" among events that may reduce the exposure available for a token.
  - The API description says "backed 1:1 by SPV exposure that tracks the price of the underlying private company" (verified, `prestocks.com/api/prestocks`).
- **Since then:**
  - No lawsuit or delisting was found; both tokens are live.
  - Prices have recovered. ANTHROPIC is at $1,042 against a mark of $1,037. OPENAI is at $1,316, **28.5% above** its mark of $1,024 (reported, API at 2026-09-24 18:12 UTC; consistent with the +29–31% premium measured in Phase 0).
  - Anthropic and OpenAI reportedly filed confidential S-1s in June 2026 (reported via a PreStocksIntern post; **no primary source**).

### What it means for a basket holder, stated plainly

- **Two of the seven names are legally contested at the source.** OpenAI and Anthropic say transfers into SPVs are void. If that holds, those two legs' value rests entirely on PreStocks' undisclosed hedges and discretion. It could be written down to near zero, and holders have no claim against the companies, the SPVs or PreStocks.
- **OpenAI's leg carries a separate premium risk.** It trades about 28–31% above PreStocks' own reference value, so a collapse of that premium alone would cost the leg about a quarter of its value.
- **The basket limits this to those legs.** At equal weight, the two names are about 2/7 (≈ 29%) of inception value. A write-down of both to zero costs the basket that share, and the other five legs keep paying out.
- **The basket doesn't cure it.** No accounting design fixes a legally void underlying.

**Disclosure text for the app and the pitch** (to be agreed):

> Two constituents, OpenAI and Anthropic, have publicly stated that transfers of their shares to SPVs are void and that tokenized exposure "may have no value". PreStocks tokens give no claim on any company, SPV or PreStocks itself. Their value depends on PreStocks' undisclosed arrangements, which PreStocks' own terms say may be reduced or eliminated. This basket holds these tokens as they are and cannot change that.

**Options that need your decision:**
- Reduce the weights of the two contested names at inception.
- Keep equal weight with the disclosure (current spec).
- Show each leg's premium to mark prominently (already in spec 03 `values.gaps`).
