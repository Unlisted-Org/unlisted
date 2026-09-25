---
title: FAQ
description: Short answers, each pointing to the page with the evidence.
---

### Is Unlisted cheaper than buying the seven tokens?

**No, never.** Every deposit and redemption moves each leg through the vault and pays the issuer's transfer fee each time. At 300 bps that's 5.91% for a round trip from fees alone, and about 6.5–7.9% with market spread, depending on size ([What it costs](/product/how-it-works/#what-it-costs)).

### Then why use it?

Because a basket over these tokens has to survive the issuer, and the live alternative doesn't: on a mainnet fork, Symmetry burned the user's shares and paid nothing while one token was paused, and failed every redemption after a seizure ([The problem](/product/problem/#what-happens-to-a-basket-when-the-issuer-acts)). One transferable token instead of seven is a real but secondary benefit.

### What happens to my redemption if the issuer pauses a company?

It goes through. Every available leg pays now, and the paused leg becomes a claim that anyone can settle once the pause lifts ([The user flow](/product/user-flow/)).

### Is a claim worth a fixed amount?

No. A claim is a number of units of one leg. It gains and loses with that leg until it settles, including through a seizure: on devnet, a claim open during a 20% seizure settled for exactly 80% of what an unseized claim paid ([Claims](/protocol/claims/#a-seizure-while-a-claim-is-open)).

### Can I sell or transfer a claim?

Not in v1. A claim is recorded in your redemption ticket and pays out to you.

### Who settles a claim?

Anyone, once the leg is available again. The payout always goes to the claim's owner. On devnet a third party settled a holder's claim ([Claims](/protocol/claims/#paused)).

### What if the issuer seizes tokens from the vault?

The program compares the vault's real balance with what it expects on every instruction that touches the leg, and anyone can trigger that check with `observe`. A shortfall is recorded on chain and shared pro rata by every holder, claimant and open deposit. Later depositors don't make anyone whole ([Seizure handling](/product/how-it-works/#seizure-handling)).

### Where does the price come from?

There is no price in the program. Deposits and redemptions are computed from the vault's holdings. The app shows three labelled values (what you'd get selling now, the last trade, and PreStocks' reference) and the gaps between them ([The three values](/product/concepts/#the-three-values)).

### Can I deposit while a company is paused?

No. Deposits of any kind are refused while any leg is unavailable (`LegUnavailable`). Redemptions are never refused for that reason.

### Will I get warning before the fee or multiplier changes?

Only from the chain. PreStocks told the team there is no channel where such changes are announced in advance. A scheduled change exists on chain before it takes effect, and the app reads the mints directly and shows a pending change as soon as it's there ([No advance warning](/product/problem/#no-advance-warning-exists)).

### Does PreStocks endorse Unlisted?

**No.** PreStocks told the team it has no objection to the basket, including a future mainnet version, with no conditions. No objection is not an endorsement ([Introduction](/#what-prestocks-said)).

### Why are OpenAI and Anthropic still in the basket?

Both say transfers of their shares to SPVs are void. Unlisted keeps all seven at equal weight rather than take a position on a dispute it can't adjudicate, and discloses it, with Anthropic's own words ([The SPV dispute](/trust/security/#the-spv-dispute)).

### Why only devnet?

The cases that matter are the issuer's actions, and only the issuer's keys can trigger them on mainnet. On devnet a fixture issuer holds mirror copies of those powers, so each one can be run against the real program with signatures. Nothing in the project signs a mainnet transaction ([Devnet only](/trust/security/#devnet-only)).

### Why aren't SpaceX and xAI in it?

SpaceX listed on 2026-06-12 and its PreStock expires on 2027-03-12; xAI converted on 2026-09-12. The basket holds companies that aren't yet public ([The IPO rule](/product/concepts/#the-ipo-rule)).

### Can the team take the tokens in the vault?

The basket authority has no instruction that moves vault tokens or blocks redemptions ([The program](/protocol/program/#what-the-authority-can-and-cant-do)). The program's upgrade authority, a single deployer key on devnet, can replace the program; that's disclosed. The issuer, not the team, is the party that can seize from the vault.

### How do I check any of this?

Every signature on these docs links to the Solana Explorer, and the docs' verification script checks each one against the chain: finalized, without error, at its stated slot, and present in a committed record ([Evidence](/trust/evidence/)).
