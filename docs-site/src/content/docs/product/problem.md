---
title: The problem
description: What the PreStocks issuer can do to every holder, what it has done on mainnet, and what happens to a basket protocol when it acts.
---

PreStocks tokens come with an issuer that can pause them, seize them from any account, and change what it costs to move them, at short notice and without announcement. This page shows what the issuer controls and what it has done, with the mainnet transactions. Every signature below is finalized on mainnet; the docs' own check re-reads each one ([Evidence](/trust/evidence/)).

## Who controls the mints

A **Squads v4 multisig**, `53Ab3Rqx1a5uiV7qmsX4qbdbrqstVDpnH4LoJGfsZsU8`, controls every mint in the basket.

- **Threshold:** 2 of 7.
- **Time lock:** 0.
- **Its vault,** `WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc`, holds these powers on every basket mint: mint, freeze, permanent delegate, pause, fee, withdraw-withheld, hook, multiplier and metadata.

PreStocks' Terms of Service reserve the right to "restrict, suspend, disable, deprecate, delist, pause, wind down, compulsorily redeem, or permanently discontinue any token", and to "freeze … recover, claw back, or compulsorily transfer or re-assign any token; … burn" (quoted in `docs/risks.md` from `prestocks.notion.site/terms-of-service`).

## What it has done on mainnet

### Seized tokens from 29 holder accounts

On **2025-09-19**, the permanent delegate (the multisig's vault) signed `transferChecked` out of **29 token accounts owned by other wallets**, across seven transactions, and **emptied every one to zero**.

- **Tokens moved:** XAI 26.86, SPACEX 3.66, ANDURIL 1.75, OPENAI 0.69, ANTHROPIC 0.20. They went mostly to an account owned by `CTSxn7dte66zxZT61XDHMYM6stypJySBbQF5tpnjgvBz`.
- **Two of the seven transactions:**
  - [`2smHrk8U…H6QxvkHB`](https://explorer.solana.com/tx/2smHrk8UHqyZgqWS5ozisWGitWFMPv6mmA2VNnVSv45xrEU7uMDXycKMrSbE6YNapp9YF6Xd1ESt4aZwH6QxvkHB) (7 accounts)
  - [`3Umb9MA4…1WaWiY7y`](https://explorer.solana.com/tx/3Umb9MA4U4LzWdpuT24qLDUdAsvn7UXgwSwgPtd39UVEDFHVnZJWY7cTVHew6Q3rhC11zWvBPQvkPEsE1WaWiY7y) (6 accounts)
- **Why: unknown.** No memo explains it. It may have been a compliance sweep or launch-period cleanup; the records don't guess.
- **Since then:** no further use against holders was found in the 963 transactions from March to September 2026.

### Changed the transfer fee three times in sixteen days

All three changes were signed by the issuer's vault.

<div class="stack fee">

| # | Change | Set on chain (UTC) | Takes effect (UTC) | Notice | Announcement |
|---|---|---|---|---|---|
| 1 | 0 → **50 bps** | 2026-09-08 16:24–16:39 | epoch 1032, 2026-09-10 07:12 | ≈ 38.5 h | A PreStocks post about an hour *after* the on-chain change. The prior rate of 0 is inferred from that post, not from chain history. |
| 2 | 50 → **100 bps** | 2026-09-19 07:25–07:43 | epoch 1039, 2026-09-20 21:06 | ≈ 37.4 h | None found |
| 3 | 100 → **300 bps** | 2026-09-24 17:50–18:11 | epoch 1043, ≈ 2026-09-26 04:52 (projected) | ≈ 35 h | None found |

</div>

**Change 3, one transaction per mint:**

| Mint | Transaction (mainnet) |
|---|---|
| FIGUREAI | [`3kPL56XV…MwtonUgP`](https://explorer.solana.com/tx/3kPL56XVmfLSPFv9hbKwcLTBCnHqChm8vANdZ3adV9Q5gaSoWvoPiSDSKGRkoNWb5hyWNEceCDDkLJ62MwtonUgP) |
| NEURALINK | [`38NvKxQ8…zbJMbEqY`](https://explorer.solana.com/tx/38NvKxQ8askR7FqrZLj4doFDLK8Tatfpgaqu1Y9tsuKnhc9sZ366zkqGPwDNxj1nq43gMfuVw76injsHzbJMbEqY) |
| KALSHI | [`2kCnFhFK…Wgc1C6Vc`](https://explorer.solana.com/tx/2kCnFhFK7zJL2mejcNU21SyVGGWbT4ggrsV7KFirGKYgkBjp5tiQtbhKxTNX2ghDipHUGXEvC3Kxvnz9Wgc1C6Vc) |
| ANDURIL | [`2FyJC4aN…Yf619nUq`](https://explorer.solana.com/tx/2FyJC4aNayfKdH2SzTBG6GK9s3AWEHxHNpf1HiPMdzVhRQCS4DCFX9cjofbL7vjDbx9bpEtozmSAregaYf619nUq) |
| POLYMARKET | [`43EW7SJs…TZB6saTe`](https://explorer.solana.com/tx/43EW7SJspmdsvn56M2yRpCzYVKvEKdtCfkuARTrLPk1vcEtqyKNgHN6woA5XXcfbPckC4PbrDwQdyasCTZB6saTe) |
| ANTHROPIC | [`kZFHsxbx…iKMpn2wu`](https://explorer.solana.com/tx/kZFHsxbxPBh2xSssiCjR7e5PPFhyCBhi8ou8bSoyjACAvk3nk2ZZCXn45r7zsMctcdL5qWzpAnRrc4niKMpn2wu) |
| OPENAI | [`2FxzQ66J…iUM9H3mD`](https://explorer.solana.com/tx/2FxzQ66J7U1TUnrDpBRtay71uw5BKsA5EWWsTmGkL8s6R2daNcKSHrkw3YdsB9WVXkuoqcgtTvnEgs22iUM9H3mD) |

**The minimum notice isn't PreStocks' choice.** Token-2022 makes a new rate wait until the epoch after next, which today means 32–64 hours. The ≈ 35–38 h of notice each time is close to that floor.

### Changed OpenAI's display multiplier with 9 minutes 41 seconds of warning

A scan of all 1,653 transactions the issuer vault has signed since 2025-07-23 found two `updateMultiplier` instructions. Warning is measured from the transaction's block time to the new multiplier's effective time.

<div class="stack mult">

| Mint | New multiplier | Signed (UTC) | Effective (UTC) | Warning | Transaction (mainnet) |
|---|---|---|---|---|---|
| OPENAI (in the basket) | 1.4861347 | 2026-07-17 16:20:19 | 2026-07-17 16:30:00 | **9 min 41 s** | [`2bNNe87c…RECyvFAQ`](https://explorer.solana.com/tx/2bNNe87cA182GFke6h5DnE8X7itPTnxDaaKnHsh1DvjeE5EoWu3q3cVVKrkNsprLf1YCGxhpGWN1FdNBRECyvFAQ) |
| SPACEX (not in the basket) | 5 | 2026-06-10 04:01:15 | 2026-06-10 04:30:00 | 28 min 45 s | [`EymeLSUs…vEP9yQ1G`](https://explorer.solana.com/tx/EymeLSUsiPvcJWGvAQvFdy4s8dgYfGed88hhdGxXQb2pnK6MUJ8A6DWNyXDb5YBQcmMZcBnQuMCcN7GvEP9yQ1G) |

</div>

The multiplier changes only what wallets display. The raw token amounts, and so what the basket holds and pays, don't change, and the program never reads it. The claim here is narrow: the issuer changed OpenAI's display multiplier with under ten minutes' notice. It isn't a claim about its usual notice.

### Pause and freeze: available, not seen used

The records show no mainnet pause or account freeze by the issuer. The scan behind that is partial: roughly 714 of the multisig's last 1,000 transactions contain no Pause or FreezeAccount instruction (reported in `docs/risks.md`, not verified). The powers exist on every mint. On devnet, a fixture mint with the same Token-2022 extension set as the PreStocks mints (`5vcYoRJcfzk8Xv5spWusaxLBJcp6p99GSvk7f4x2wi4t`) was used to exercise them against a vault owned by a program PDA:

- a permanent-delegate burn of 2.5 tokens from a PDA vault, without the vault signing: [`2ouUBzUZ…TfRiCG63`](https://explorer.solana.com/tx/2ouUBzUZniEC3BYJzBbFQXRvjR4o3HF23FVioDutXfKd8XQScHHNLDBTaCWgNWEzE7w5SpS4t3zPimCQTfRiCG63?cluster=devnet);
- a pause, after which a transfer was rejected with `MintPaused` (0x43): [`2ttKtuiU…7d3fbzcf`](https://explorer.solana.com/tx/2ttKtuiUFcPSV42D7XcsdHXz4H7TXMqyypwesmdAvu7zvzXz5Wbv4ac38ZkN3RHxbr9XmweA9Gvu5fZF7d3fbzcf?cluster=devnet).

Rejected transactions never land, so the `MintPaused` and `AccountFrozen` (0x11) rejections themselves have no signature; they were recorded from the RPC's preflight response.

## No advance warning exists

PreStocks told the team on 2026-09-25 that **there is no channel where fee or multiplier changes are announced in advance** (as relayed; the verbatim reply isn't in the repository yet). A scheduled change does exist on chain before it takes effect: a new transfer fee applies from the epoch after next, and a new multiplier carries its effective timestamp. Reading the mints directly is therefore the only advance warning a holder can get. The Unlisted app does that on every refresh, and the valuation service's watcher records every issuer change with its transaction ([Architecture](/protocol/architecture/#the-valuation-api)).

## What happens to a basket when the issuer acts

**Symmetry** is the live, permissionless basket protocol anyone could use for this today. Its real deployed program (`BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`) was run on a local Surfpool fork of mainnet, driven by its own SDK against a live vault (NIT, whose xStocks carry the same `pausable` and `permanentDelegate` extensions as PreStocks):

- **Pause one constituent mid-redemption.** The user's shares are burned first. The redemption then fails with `MintPaused` (0x43), and the user receives **none** of the other constituents until the issuer unpauses. While paused, they hold neither shares nor tokens.
- **Seize one constituent from the vault.** Symmetry keeps recording the seized tokens and keeps accepting sells against them. Every redemption then fails with `insufficient funds` and pays **nothing**, including the five constituents that weren't seized.
- **On live mainnet,** at slot 450,108,480, one Symmetry vault (STACCINDEX) records amounts that differ from its actual balances by up to 143,279,108,005 raw units. Symmetry keeps its own records and doesn't reconcile them to the chain.

**What Symmetry gets right: the transfer fee.** A 300 bps fee mint in a live vault reconciles to the unit across its full four-transaction history. The fee isn't the problem; the pause and the seizure are.

The fork transactions exist only on the local fork, so they can't be looked up on an explorer. `cd evidence/symmetry-fork; ./run.sh` reproduces them from fresh forks ([Getting started](/start/getting-started/#reproduce-the-symmetry-failure)).

**Unlisted's answer** to the same two actions is on [How it works](/product/how-it-works/), and the signed devnet runs are on [The user flow](/product/user-flow/) and [Evidence](/trust/evidence/).

<div class="sources">

Sources: `docs/risks.md` §1–§2; `evidence/README.md` §2–§3; `evidence/symmetry-fork/README.md` and `out/*.json`; `web/lib/evidence.json`.

</div>
