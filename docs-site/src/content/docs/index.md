---
title: Introduction
description: Unlisted is a basket of seven tokenized pre-IPO companies in one token, on Solana devnet, built to keep paying out when the issuer acts.
---

**Unlisted is a basket of seven tokenized pre-IPO companies in one token, on Solana:** OpenAI, Anthropic, Neuralink, Anduril, Polymarket, Kalshi and FigureAI.

The tokens are **PreStocks**, Token-2022 mints issued by PreStocks. The basket holds them at equal weight in a program-owned vault and issues one share token against them.

## Why it exists

The issuer of these tokens can pause any of them, seize them from any account, change the transfer fee and change the display multiplier. On mainnet it has seized tokens from 29 holder accounts, changed the fee three times in sixteen days, and changed OpenAI's multiplier with 9 minutes 41 seconds of warning ([The problem](/product/problem/)).

A basket over these tokens has to keep working when the issuer acts. Unlisted is built so that:

- **A pause doesn't lock the basket.** A redemption pays every leg that's available immediately. A paused, frozen or hooked leg becomes a *claim* that pays out once the leg is available again ([Claims and settlement](/protocol/claims/)).
- **A seizure is observed and shared pro rata.** The vault's real balance is the truth. Every holder bears a shortfall in proportion; no later depositor makes anyone whole ([How it works](/product/how-it-works/#seizure-handling)).
- **There is no oracle.** Deposits and redemptions are computed from what the vault holds. The app shows three labelled values instead of one "price" ([Core concepts](/product/concepts/#the-three-values)).

**It doesn't protect you from the issuer.** The claim is narrower: the basket degrades one name at a time instead of failing whole. It also costs more than buying the seven tokens directly ([Cost](/product/how-it-works/#what-it-costs)).

## The seven companies

Each leg on devnet is a **fixture mint** that mirrors the real PreStocks mint, extension for extension (`fixtures/DIFF.md`). Fixture addresses are from `fixtures/registry.json`.

| # | Company | Fixture mint (devnet) | Mirrors the mainnet PreStocks mint |
|---|---|---|---|
| 0 | OpenAI | `AoALoXQiT2d96fKyXLnEgfAwCMBCbfuktG5tAYwxVW2M` | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` |
| 1 | Anthropic | `kW6VrnFFAJCpi5UZ9dGvH1wmTNSAnG1AkgQr2JGo29Q` | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` |
| 2 | Neuralink | `Bopp1cziw4BSo8e65zTPnR5QCcXkG1HQ4CmGJr8obLUs` | `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` |
| 3 | Anduril | `AFun4hysF5E6KWTePygHik9iss71XTwYcXtXeSVRtz2m` | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` |
| 4 | Polymarket | `5TSgWpjEsygK9h4cF66ATWMat6TkXQkJvHJ5HDaM7AFg` | `Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP` |
| 5 | Kalshi | `D9zy2VqnveEYjqH9SJhuqc3KCb6AnDYSciFnE3Qga9z9` | `PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua` |
| 6 | FigureAI | `Ac2fWYpnj81xGTJxxPNRLPf2sP1ozj5in6fjsbxMZUqJ` | `PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd` |

**Left out:** SpaceX (listed 2026-06-12; its PreStock expires 2027-03-12) and xAI (converted 2026-09-12). Spec 01 records the reasons.

## Status: devnet only

- **Devnet only, by design.** The cases that matter are issuer actions, and only the issuer's keys can trigger them on mainnet. On devnet a fixture issuer key holds every fixture authority, so each issuer action can be run against the real program, with a signature for each step.
- **Program:** `GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv` on devnet ([The program](/protocol/program/)).
- **Canonical basket:** `GJueMRWMqH8AMRBD8JP1qXS3vBGAAsjeyNWrYBzeWwJV`; share mint `HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj`.
- **The app:** [unlisted-rosy.vercel.app/app](https://unlisted-rosy.vercel.app/app), devnet only. Prices come from the mainnet market for the real token each fixture mirrors, and the app says so on every value.
- **Never mainnet.** Nothing in this project signs a mainnet transaction. Mainnet is only read.

## What PreStocks said

The team wrote to PreStocks (legal@prestocks.com) on 2026-09-25 with three questions, and PreStocks replied the same day. The answers below are as relayed to the team and recorded in `docs/risks.md`. **The verbatim reply isn't in the repository yet**, so nothing here is quoted as PreStocks' own words.

1. **No objection** to a pooled basket token over PreStocks, including a future mainnet version, with no conditions attached. That is permission to proceed, **not an endorsement**. PreStocks has not endorsed Unlisted.
2. **A program-owned vault gets no different treatment** from any other holder under their pause, freeze and recovery powers. The vault is no safer than any wallet. That is the assumption the design was built on, now confirmed.
3. **There is no channel where fee or multiplier changes are announced in advance.** A scheduled change exists on chain before it takes effect, so reading the mints directly is the only advance warning a holder can get. The app reads the mints on every refresh (every 15 seconds on the hosted app) and shows each pending change the moment it exists on chain.

## Where to go next

- **The thesis in one page:** [The user flow](/product/user-flow/): buy in, the issuer pauses a company, redeem anyway, the claim pays out.
- **Use the app:** the [Dashboard guide](/app/dashboard/) and [Wallet connection](/app/wallet/).
- **Check it yourself:** [Evidence](/trust/evidence/) and [Getting started](/start/getting-started/).
- **The risks we disclose:** [Security and assumptions](/trust/security/).

<div class="sources">

Sources: `README.md`; `docs/risks.md` (§2, *PreStocks' reply*); `docs/outreach/2026-09-25-prestocks-request.md`; `docs/specs/01-shares-and-pricing.md` (*Constituents*); `fixtures/registry.json`; `tests/program/devnet/canonical.json`; `web/app/config.json/route.ts`.

</div>
