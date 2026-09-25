---
title: Security and assumptions
description: What Unlisted does and doesn't protect against, the SPV dispute in Anthropic's own words, the known limitation, and why it's devnet only.
---

## The founding assumption

**The vault is no safer than any wallet.** The issuer's pause, freeze, seizure, fee and multiplier powers reach the basket's vault exactly as they reach any holder. PreStocks confirmed this on 2026-09-25: a program-owned vault gets no different treatment under their pause, freeze and recovery powers (as relayed to the team; the verbatim reply isn't in the repository yet). The design starts from that assumption instead of hoping around it.

## What it does and doesn't protect against

**We don't claim protection from the issuer. We claim the basket degrades per name instead of failing whole.**

| When the issuer… | Unlisted… | It doesn't… |
|---|---|---|
| pauses a leg, freezes the vault, or switches on a transfer hook | pays every other leg now and turns that leg into a claim, settled by anyone once the leg is available | pay the affected leg before the issuer lets it move. Deposits are refused until then. |
| seizes from the vault | records the shortfall on chain and spreads it pro rata over every holder, claimant and open deposit | recover the tokens, or make anyone whole from later deposits |
| raises the transfer fee | credits every deposit at its measured net and charges each outflow's fee to its recipient; nothing breaks | shield anyone from the fee. Every deposit and redemption pays it on every leg. |
| changes a display multiplier | nothing: the program never reads it | — |
| keeps a hook on permanently | holds the claims on that leg | settle them without a program upgrade that adds reviewed hook support |

And outside the issuer's powers:

- **No oracle.** No price enters the program, so there is no price feed to manipulate. The three values the app shows are display only ([Core concepts](/product/concepts/#the-three-values)).
- **Rounding** always favours the vault, so the total owed never exceeds what it holds (checked by the reference model across 300 random sequences).
- **Routers are trusted for nothing.** Every swap is judged by measured balance changes, and a basket-signed route may not touch any other basket account ([Routers](/protocol/flow/#routers-trusted-for-nothing)).
- **The basket authority** can't move vault tokens or block redemptions ([The program](/protocol/program/#what-the-authority-can-and-cant-do)). The **upgrade authority**, a single deployer key on devnet, can replace the program. That is disclosed, not removed.

## The SPV dispute

Two of the seven companies, OpenAI and Anthropic, say transfers of their shares to special purpose vehicles are void. Both stay in the basket at equal weight: down-weighting them would mean taking a position on a dispute Unlisted can't adjudicate, and the basket would stop being equal weight. At inception the two are about 2/7 (≈ 29%) of the basket's value.

**Anthropic, primary source, verbatim** ([support.claude.com, article 13704655](https://support.claude.com/en/articles/13704655-unauthorized-anthropic-stock-sales-and-investment-scams); updated 2026-06-29, first published 2026-02-11), as recorded in `docs/risks.md` §3:

> "We do not permit special purpose vehicles (SPVs) to acquire Anthropic stock and any transfer of shares to an SPV are void under our transfer restrictions."

> "Any third party claiming to sell Anthropic shares to the general public—whether through direct sales, 'forward contracts,' tokenized securities, or other mechanisms—is likely offering an investment that may have no value due to our transfer restrictions."

> "Any sale or transfer of Anthropic stock, or any interest in Anthropic stock, that has not been approved by our Board of Directors is void and will not be recognized on our books and records."

**OpenAI (reported, not verified against the primary text).** Equity cannot be "directly or indirectly transferred" without OpenAI's written consent, and an unauthorized sale "will not be recognized and carry no economic value". The source page, [openai.com/policies/unauthorized-openai-equity-transactions](https://openai.com/policies/unauthorized-openai-equity-transactions/), returned 403 when the team tried to read it; the wording is from press coverage.

**What a PreStock is** (verified against PreStocks' Terms): "Bearer digital tokens that reference economic exposure to designated pre-IPO companies". The risk factors list "refused consent" among the events that may reduce the exposure behind a token. PreStocks tokens give no claim on any company, SPV or PreStocks itself.

**The market's reaction:** ANTHROPIC fell 34% and OPENAI 39% over the seven days after the warnings were publicised on 2026-05-13 ([CoinDesk](https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid)). No lawsuit or delisting was found, and both tokens are live.

## Known limitation: a ticket-owned account left out of an abort

A USDC deposit may need an intermediate token account owned by the ticket (Jupiter routes need the taker's own output account). `finalize_deposit` and `abort_deposit` close every such account passed to them, returning the rent to the owner.

**If a client leaves one out, the program accepts it.** The account survives holding the owner's rent (≈ 0.0016 SOL), and once the ticket is closed nothing can close it. The program can't refuse: it can't list the token accounts a program address owns, and the client, not the program, creates them.

- **Found by** a deliberately broken version on devnet: an abort that skipped the account was accepted (`tests/program/devnet/refund-path.json`, broken version (b)).
- **Mitigation now:** the SDK always passes every ticket-owned account it created, and both the program's devnet check and the app's browser test assert that the ticket owns no token account afterwards, on both token programs.
- **Planned after the hackathon:** a permissionless `sweep_ticket_account` that re-derives the closed ticket's address and closes a stranded account, rent to the owner. **Not built.**
- **Scope:** only rent, only the owner's, and only through a client that omits accounts. No user funds are at risk.

## Devnet only

- **Everything that writes runs on devnet or a local fork.** Nothing in this project signs a mainnet transaction. The fixture mints hold no PreStocks tokens, and the devnet basket holds no one's real tokens.
- **Why devnet is the right place to prove it:** the cases that matter are issuer actions, and only the issuer's keys can trigger them on mainnet.
- **The deployed app's server holds the devnet fixture issuer's key**, as a platform secret, never committed. It uses it for two things: minting test tokens to a visitor's wallet, and the demo's pause and resume, which need the presenter's passcode. That key has the same powers over the fixture mints as PreStocks' multisig has over the real ones, including over the fixture vault, which is the point of the demo. It has no power on mainnet.
- **Prices are mainnet's.** The app values the devnet basket at mainnet market prices for the real tokens, and says so on every value.

**Where a mainnet version would differ** (flagged in `docs/risks.md`, not legal advice):

- A mainnet version would hold real PreStocks tokens for users. PreStocks' Terms prohibit US persons and a long list of jurisdictions, so geofencing would be needed, along with a securities view on offering a pooled token over them.
- PreStocks told the team it has no objection to a mainnet version, with no conditions. That is not an endorsement, and it isn't presented as one.
- The app and these docs name PreStocks and show their prices; they must not imply endorsement. PreStocks' Terms say an integration's existence "implies no relationship with, or approval by, us".

## Not yet proven

- **A redemption after a fee change takes effect.** The fixture fee 100 → 300 bps is scheduled on chain for devnet epoch 1167, and a redemption before it paid under 100 bps. The redemption under 300 bps can only run once the epoch begins.
- **The spread estimates** (≈ 6.5%, 7.2% and 7.9% round trip at 300 bps) are arithmetic on spreads measured on 2026-09-24, to be re-measured after epoch 1043.

<div class="sources">

Sources: `docs/risks.md` §2–§3, *PreStocks' reply*; `docs/specs/02-onchain-interface.md` (*Known limitation*, *Authority*); `tests/program/devnet/refund-path.json`; `docs/deploy.md`; `web/lib/server/issuer.ts`, `web/app/api/faucet/route.ts`, `web/app/api/issuer/route.ts`.

</div>
