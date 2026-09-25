# The issuer, the fee, and the SPV dispute

Updated 2026-09-25. Each claim is labelled **verified** (read live, or checked against the primary text by the spec owner) or **reported** (from a research sub-agent, with its source).

These aren't risks we hope nobody asks about. They are the reason the product exists. PreStocks tokens come with an issuer that can pause them, seize them from any account, and change what it costs to move them, at short notice and without announcement. The sections below show that it has done each of these. A basket over these tokens has to keep paying out when the issuer acts. Ours is built to; the live alternative is shown failing in `evidence/symmetry-fork/`.

---

## 1. The fee: three changes in sixteen days

**Verified on-chain.** All changes were signed by the issuer multisig's vault `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`. Epoch start times come from `getBlockTime`; the epoch-1043 time is projected at the measured 0.2657 s/slot.

| # | Change (basket names) | Set on-chain (UTC) | Takes effect (UTC) | Notice | Announcement |
|---|---|---|---|---|---|
| 1 | 0 → **50 bps** | 2026-09-08 16:24–16:39 | epoch 1032, 2026-09-10 07:12 | ≈ 38.5 h | A PreStocks post at 2026-09-08 **17:40**, an hour *after* the on-chain change, says they are "experimenting with non-zero transfer…" ([x.com/PreStocks/status/2097379481975759256](https://x.com/PreStocks/status/2097379481975759256)). The rest of the post was truncated in the copy we could read. The prior rate of 0 is inferred from that post, not from chain history. |
| 2 | 50 → **100 bps** | 2026-09-19 07:25–07:43 | epoch 1039, 2026-09-20 21:06 | ≈ 37.4 h | **None found** |
| 3 | 100 → **300 bps** | 2026-09-24 17:50–18:11 | epoch 1043, ≈ 2026-09-26 04:52 | ≈ 35 h | **None found** |

**Change 3 signatures:**

| Mint | Signature |
|---|---|
| FIGUREAI | `3kPL56XVmfLSPFv9hbKwcLTBCnHqChm8vANdZ3adV9Q5gaSoWvoPiSDSKGRkoNWb5hyWNEceCDDkLJ62MwtonUgP` |
| NEURALINK | `38NvKxQ8askR7FqrZLj4doFDLK8Tatfpgaqu1Y9tsuKnhc9sZ366zkqGPwDNxj1nq43gMfuVw76injsHzbJMbEqY` |
| KALSHI | `2kCnFhFK7zJL2mejcNU21SyVGGWbT4ggrsV7KFirGKYgkBjp5tiQtbhKxTNX2ghDipHUGXEvC3Kxvnz9Wgc1C6Vc` |
| ANDURIL | `2FyJC4aNayfKdH2SzTBG6GK9s3AWEHxHNpf1HiPMdzVhRQCS4DCFX9cjofbL7vjDbx9bpEtozmSAregaYf619nUq` |
| POLYMARKET | `43EW7SJspmdsvn56M2yRpCzYVKvEKdtCfkuARTrLPk1vcEtqyKNgHN6woA5XXcfbPckC4PbrDwQdyasCTZB6saTe` |
| ANTHROPIC | `kZFHsxbxPBh2xSssiCjR7e5PPFhyCBhi8ou8bSoyjACAvk3nk2ZZCXn45r7zsMctcdL5qWzpAnRrc4niKMpn2wu` |
| OPENAI | `2FxzQ66J7U1TUnrDpBRtay71uw5BKsA5EWWsTmGkL8s6R2daNcKSHrkw3YdsB9WVXkuoqcgtTvnEgs22iUM9H3mD` |

The same batch set xAI to 0 bps. Change 2's signatures are in `docs/phase0-fee-escrow.md` Q4.

**The minimum notice isn't PreStocks' choice.** Token-2022 forces a new rate to wait until the epoch after next, which today means 32–64 hours. The ≈35–38 h of notice each time is close to that floor.

### What it costs to use the basket, stated plainly

**Fees.** Every deposit and every redemption moves each leg through the vault and pays the issuer's fee on each transfer.

| Fee rate | Round-trip cost from fees alone |
|---|---|
| 100 bps | 1.99% |
| 300 bps | `1 − 0.97²` = **5.91%** |

**Spread.** On top of the fees, market spread measured on 2026-09-24 adds about 0.5% at $10, 1.3% at $1k and 2.0% at $10k. Estimated round trips at 300 bps are therefore **≈ 6.5%, 7.2% and 7.9%**. This is arithmetic on measured spreads, to be re-measured after epoch 1043.

**Minting or redeeming Unlisted is never cheaper than buying the seven tokens directly.** At best it costs the same. Unlisted's convenience (one transferable token, one account instead of seven) is real but secondary. Trading the Unlisted token itself pays no PreStocks fee; see §2 for what that means.

**The accounting is unaffected by any of this.** No fee is stored. Every inflow is credited at its measured delta, and each payout's fee falls on its recipient. The *fee change mid-position* fixture scenario reproduces change 3 on devnet.

---

## 2. Pause and seizure: what the issuer can do, and has done

### Who controls the mints (verified)

A Squads v4 multisig, `53Ab3Rqx1a5uiV7qmsX4qbdbrqstVDpnH4LoJGfsZsU8`, controls every mint. Its threshold is **2 of 7** with a **time lock of 0**. Its vault holds these powers on every basket mint: mint, freeze, permanent delegate, pause, fee, withdraw-withheld, hook, multiplier and metadata.

### The seizure power has been used on holders (verified)

- **When and what.** On 2025-09-19, the permanent delegate (the multisig vault) signed `transferChecked` out of **29 token accounts owned by other wallets**, across seven transactions, **emptying every one to zero**.
- **Tokens moved:** XAI 26.86, SPACEX 3.66, ANDURIL 1.75, OPENAI 0.69, ANTHROPIC 0.20. They went mostly to an account owned by `CTSxn7dte66zxZT61XDHMYM6stypJySBbQF5tpnjgvBz`.
- **Examples:**
  - `2smHrk8UHqyZgqWS5ozisWGitWFMPv6mmA2VNnVSv45xrEU7uMDXycKMrSbE6YNapp9YF6Xd1ESt4aZwH6QxvkHB` (7 accounts)
  - `3Umb9MA4U4LzWdpuT24qLDUdAsvn7UXgwSwgPtd39UVEDFHVnZJWY7cTVHew6Q3rhC11zWvBPQvkPEsE1WaWiY7y` (6 accounts)
- **Why: unknown.** No memo explains it. It may have been a compliance sweep or launch-period cleanup, and we don't guess.
- **Method.** Authority and source owner were read from each transaction's parsed instructions and `preTokenBalances`.
- **Since then.** No further use against holders was found in the 963 transactions from March to September 2026. In roughly 714 of the multisig's last 1,000 transactions there are no Pause or FreezeAccount instructions (reported, partial scan).

### Display-multiplier changes, and how much warning they gave (verified)

A read-only scan of all 1,653 transactions the issuer vault (`WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`) has signed since 2025-07-23 found two `updateMultiplier` instructions. Warning is measured from the transaction's block time to the new multiplier's effective timestamp:

| Mint | New multiplier | Signed (UTC) | Effective (UTC) | Warning | Transaction |
|---|---|---|---|---|---|
| OPENAI (in the basket) | 1.4861347 | 2026-07-17 16:20:19 | 2026-07-17 16:30:00 | **9 min 41 s** | `2bNNe87cA182GFke6h5DnE8X7itPTnxDaaKnHsh1DvjeE5EoWu3q3cVVKrkNsprLf1YCGxhpGWN1FdNBRECyvFAQ` |
| SPACEX (not in the basket) | 5 | 2026-06-10 04:01:15 | 2026-06-10 04:30:00 | 28 min 45 s | `EymeLSUsiPvcJWGvAQvFdy4s8dgYfGed88hhdGxXQb2pnK6MUJ8A6DWNyXDb5YBQcmMZcBnQuMCcN7GvEP9yQ1G` |

Both are finalized without error. The multiplier changes only what wallets display; the raw token amounts, and so what the basket holds and pays, don't change. Unlisted's program never reads it (proven on devnet: `multiplier-change-mid-position`). What we claim from this is narrow: **the issuer changed OpenAI's display multiplier with under ten minutes' notice.** We don't claim this is its usual notice.

### What their Terms reserve (verified against the ToS text, `prestocks.notion.site/terms-of-service`)

- **Enforcement.** They may "restrict, suspend, disable, deprecate, delist, pause, wind down, compulsorily redeem, or permanently discontinue any token, feature, functionality, market, pool, integration, or Service". They may also "freeze … recover, claw back, or compulsorily transfer or re-assign any token; … burn".
- **Wrapping and pooling.** Tokens "may be listed, quoted, wrapped, bridged, pooled, lent against, used as collateral, or otherwise made available by any person on any venue at any time, without our involvement, knowledge, consent, or approval. We do not endorse … any such listing, venue, pool, wrapper, derivative, or integration."
- **Fees on wrapping.** Fees apply to "any and every transaction in a token — including each transfer, trade, deposit, withdrawal, wrap, unwrap …, including on third-party … liquidity pools, aggregators".
- **Where fees go.** Fees may be "applied for our own account unless we expressly state otherwise in writing." We therefore assume the vault receives no fee income. The ecosystem page's RevShare claim that fees go to holders is not borne out by a sampled on-chain trail (reported).

### What happens to a basket when the issuer acts

- **Symmetry**, the live basket protocol anyone could use for this, run with its own program on a mainnet fork (`evidence/symmetry-fork/`):
  - **Pause:** with one leg paused mid-redemption, the shares are already burned and the user receives none of the other constituents until the issuer unpauses.
  - **Seizure:** Symmetry keeps recording the seized tokens, accepts sells against them, and every redemption then fails and pays nothing.
  - **Fees:** Symmetry handles the transfer fee correctly. We say so, because the other two points are the ones that matter.
- **Ours** (spec 01; 17 property tests in `spec/model/`; fixture scenarios in progress):
  - **Pause:** the redemption pays every leg the issuer didn't touch and turns the paused leg into a claim that pays out after resume.
  - **Seizure:** the vault's actual balance is the truth. A seizure is observed, shared pro rata among all holders, and shown. No one is made whole by later depositors.
  - **No oracle** anywhere.

**We don't claim protection from the issuer. We claim the basket degrades per name instead of failing whole.**

### Issuer stance (decided)

| Question | Decision |
|---|---|
| Written OK from PreStocks? | **Requested in writing; the user is sending it.** It blocks nothing. The Terms appear to permit wrapping and pooling "without our involvement, knowledge, consent, or approval", so we proceed on the assumption that consent isn't required, and record any reply in [`docs/outreach/2026-09-25-prestocks-request.md`](outreach/2026-09-25-prestocks-request.md). |
| Route a fee to PreStocks? | **No.** It complicates the product and concedes a point nobody has made. Every basket deposit and redemption already pays their fee on every leg. What skips it is secondary trading of the Unlisted token, the product category their own bounty invites ("structured products", "DeFi integrations"). |
| Geoblock? | **No; plain disclosure instead.** This is devnet, with fixture tokens that mirror PreStocks and no real PreStocks tokens held by anyone through us. See the note below. |

**Where the legal exposure would differ** (flagged, not legal advice):
- **The devnet product holds no PreStocks tokens**, so their Terms, which bind anyone "acquiring, holding, transferring" tokens, don't reach the devnet basket.
- **It changes at mainnet.** A mainnet version would hold real PreStocks tokens for users, and the Terms prohibit US persons and a long list of jurisdictions. Geofencing would then be needed, along with a securities view on offering a pooled token over them.
- **Using the PreStocks name.** The app and pitch name PreStocks and show their prices and marks. They must not imply endorsement; the Terms say an integration's existence "implies no relationship with, or approval by, us".

---

## 3. The SPV dispute: OpenAI and Anthropic say the underlying transfers are void

### Decision: all seven legs stay at equal weight, and the dispute is disclosed plainly

Down-weighting OpenAI and Anthropic would mean taking a position on a dispute we can't adjudicate, and the basket would stop being equal weight.

### The facts

**Anthropic, primary source, verified verbatim** ([support.claude.com article 13704655](https://support.claude.com/en/articles/13704655-unauthorized-anthropic-stock-sales-and-investment-scams); updated 2026-06-29, first published 2026-02-11):

> "We do not permit special purpose vehicles (SPVs) to acquire Anthropic stock and any transfer of shares to an SPV are void under our transfer restrictions."

> "Any third party claiming to sell Anthropic shares to the general public—whether through direct sales, 'forward contracts,' tokenized securities, or other mechanisms—is likely offering an investment that may have no value due to our transfer restrictions."

> "Any sale or transfer of Anthropic stock, or any interest in Anthropic stock, that has not been approved by our Board of Directors is void and will not be recognized on our books and records."

**OpenAI (reported).** Equity cannot be "directly or indirectly transferred" without OpenAI's written consent, and an unauthorized sale "will not be recognized and carry no economic value". Sources: [openai.com/policies/unauthorized-openai-equity-transactions](https://openai.com/policies/unauthorized-openai-equity-transactions/), which returned 403 to us, and press coverage.

**Market reaction and aftermath:**
- ANTHROPIC fell 34% and OPENAI 39% over the seven days after the warnings were publicised on 2026-05-13 ([CoinDesk](https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid), verified).
- CoinDesk also reports that PreStocks had promised attestation reports and had not published them. No PreStocks response was found.
- No lawsuit or delisting was found, and both tokens are live.
- On 2026-09-24, OPENAI traded ≈ 28–31% above PreStocks' own reference value, and ANTHROPIC close to it (verified in Phase 0; reported at 18:12 UTC).

**What a PreStock is (verified against the Terms).** "Bearer digital tokens that reference economic exposure to designated pre-IPO companies". The risk factors list "refused consent" among the events that may reduce the exposure behind a token.

### Disclosure text (app and pitch)

> Two of the seven companies in Unlisted, OpenAI and Anthropic, have said publicly that transfers of their shares to special purpose vehicles are void. Anthropic says third parties selling its shares through tokenized securities are "likely offering an investment that may have no value". PreStocks tokens give no claim on any company, SPV or PreStocks itself. Their value depends on PreStocks' own undisclosed arrangements, which PreStocks' terms say may be reduced or eliminated. Unlisted holds these tokens as they are, at equal weight with the other five, and cannot change that. At inception these two names are about 2/7 (≈ 29%) of the basket's value.
