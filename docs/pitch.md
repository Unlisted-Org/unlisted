# Pitch

Audience: Colosseum Crypto World's Fair judges. Every claim below links to evidence in this repo. If a claim has no evidence, it doesn't go in the video.

## Headline

**A basket of tokenized pre-IPO companies that still pays you out when the issuer acts.**

## The problem, as it actually happened

Tokenized real-world assets come with an issuer that can pause the tokens, seize them from any account, and change what it costs to move them, at short notice. That isn't hypothetical for PreStocks, the pre-IPO tokens this basket holds:

- **It has seized.** On 2025-09-19 the issuer's permanent delegate emptied 29 holders' token accounts across five mints to zero, with no memo explaining why. ([evidence](../evidence/README.md#3-the-issuer-has-already-used-the-seizure-power-mainnet-verified))
- **It changes the terms fast.** The transfer fee changed three times in sixteen days: 0 → 50 bps (8 Sep), 50 → 100 bps (19 Sep), and 100 → 300 bps on all seven names (set 24 Sep, effective ≈ 26 Sep). Notice each time was the protocol minimum of about 35–38 hours. No announcement was found for the last two. ([risks §1](risks.md#1-the-fee-three-changes-in-sixteen-days))
- **The controls are a 2-of-7 multisig with no time lock.** Pause, freeze, seize, fee and multiplier all sit behind it. ([risks §2](risks.md#2-pause-and-seizure-what-the-issuer-can-do-and-has-done))

**Basket protocols break when the issuer acts.** We ran Symmetry, a live Solana basket protocol anyone could use for this today, with its own program on a mainnet fork ([evidence](../evidence/symmetry-fork/README.md)):

- **Pause one constituent mid-redemption.** The user's shares are already burned, the redemption reverts, and they receive **none** of the other constituents until the issuer unpauses.
- **Seize one constituent from the vault.** Symmetry keeps counting the seized tokens and keeps accepting sells. Then **every** redemption fails and pays nothing.
- **Live on mainnet,** Symmetry's recorded holdings already disagree with its actual balances, by up to 143 billion raw units in one vault.

**What Symmetry gets right:** it handles the 3% transfer fee on a live vault exactly, to the unit. We say so. The problem isn't fees. It's what happens when the issuer acts.

## What we built

A vault-backed token over seven PreStocks, equal weight: OpenAI, Anthropic, Neuralink, Anduril, Polymarket, Kalshi and FigureAI. Three rules make it survive the issuer ([spec 01](specs/01-shares-and-pricing.md)):

1. **A pause in one name doesn't lock the basket.** Redemption pays every leg the issuer didn't touch, immediately. The paused leg becomes a claim that pays out after resume and shares that leg's gains and losses in the meantime.
2. **A seizure is detected and shared, not hidden.** The vault's actual balance is the truth, not a recorded number. A seizure is observed on-chain, reduces every holder's claim on that leg pro rata, and is shown in the app. No one is made whole by later depositors.
3. **No oracle.** Mint and redeem are computed from the vault's holdings. The app shows three labelled values: *what you'd get selling now*, *last trade*, and *PreStocks' own reference*. It shows their ages and the gaps between them, never a single "price".

The share maths was written as an executable model before the program. Its 17 property tests cover rounding (always in the vault's favour), seizure, partial redemption and the IPO rule. Deliberately breaking any rule makes them fail. Writing the model first caught a real design bug: USDC redemptions would have escaped the pro-rata seizure rule. ([model](../spec/model/))

## Why devnet is the right place to prove it

The failure cases are issuer actions (pause, seize, fee change, multiplier change, hook switched on) and only the issuer's keys can trigger them. On mainnet they can't be tested at all. On devnet, fixture mints that mirror PreStocks extension for extension (the diff is published) let us run every one of them against our program, with a signature for each step. ([spec 02 Fixtures](specs/02-onchain-interface.md#fixtures-first-class-owned-by-agent-c))

## What it costs, plainly

- **Minting or redeeming through the basket is never cheaper than buying the seven tokens directly.** Every leg pays the issuer's fee on the way in and on the way out.
  - At 100 bps that is about 2% in fees for a round trip; at 300 bps, about 5.9%.
  - With market spread, the estimate is **about 6.5–8% for a round trip at 300 bps**, depending on size. ([risks §1](risks.md#what-it-costs-to-use-the-basket-stated-plainly))
- **Secondary benefits:** one transferable token instead of seven, and one account instead of seven. Transfers of the basket token itself pay no PreStocks fee.

## What we disclose

- **The SPV dispute.** OpenAI and Anthropic say share transfers to SPVs are void. Anthropic, verbatim: third parties selling its shares through tokenized securities are "likely offering an investment that may have no value". Both stay at equal weight: we don't adjudicate the dispute, and we state the exposure (about 29% of the basket at inception). ([risks §3](risks.md#3-the-spv-dispute-openai-and-anthropic-say-the-underlying-transfers-are-void))
- **No endorsement.** PreStocks hasn't endorsed this project. We have asked them in writing. ([request](outreach/2026-09-25-prestocks-request.md))
- **No protection claimed.** We don't claim protection from the issuer, only that the basket degrades per name instead of failing whole.

## Video outline (2–3 minutes)

1. **0:00–0:25.** "The issuer can pause, seize, and triple your fees. It has." Seizure transaction on screen, then the fee-change timeline.
2. **0:25–1:05.** Symmetry on a mainnet fork: pause → shares burned, nothing received; seizure → every redemption fails. Then: "It handles fees correctly. That's not the problem."
3. **1:05–2:05.** Ours on devnet, with signatures shown:
   - pause one leg → redeem → six legs paid, a claim for the seventh;
   - resume → the claim settles;
   - seize from the vault → the drop is shown and shared pro rata.
4. **2:05–2:40.** The three-value price panel, the cost stated plainly, and the SPV disclosure.
5. **2:40–3:00.** Who it's for: holders of issuer-controlled RWAs who need a basket that fails per name, not whole.
