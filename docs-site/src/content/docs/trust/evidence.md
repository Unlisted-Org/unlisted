---
title: Evidence
description: How to check every claim Unlisted makes, what counts as proof, where the records are, and what isn't proven yet.
---

**Every claim here is backed by one of four things**, the definition of "proven" the project works to (spec 00):

- a **confirmed devnet transaction**, which you can open on any explorer;
- a **mainnet-fork run**, recorded with its fork slot;
- a flow completed **in a real browser by a wallet created for the test**;
- a **figure read live at a stated slot**.

Anything else is labelled: *reported* (from research, with its source), *local* (run on a local validator), or *not yet proven*.

**Every test counts only after it has been seen to fail.** Before a check counts, it's run against a deliberately broken version of the thing it tests, and the failing output is recorded next to it. Examples: rounding a payout up by one unit, letting an open ticket escape a shortfall, paying a paused leg instead of creating a claim, ignoring the pause flag in the app, ignoring the loss index in the SDK.

## Where to look

| What | Where |
|---|---|
| Every transaction behind the landing page, each checked on chain before the site builds | [unlisted-rosy.vercel.app/evidence](https://unlisted-rosy.vercel.app/evidence) |
| The whole proven list, rebuilt from the records and re-verified on chain | `python3 evidence/build-proven.py --out <file>` ([see the note below](#re-verify-everything-yourself)) |
| The issuer's record: fees, seizure, multiplier, SPV dispute | [`docs/risks.md`](https://github.com/Unlisted-Org/unlisted/blob/main/docs/risks.md) |
| Symmetry on a mainnet fork | [`evidence/symmetry-fork/`](https://github.com/Unlisted-Org/unlisted/tree/main/evidence/symmetry-fork) |
| The program's devnet scenarios, one JSON record each | [`tests/program/devnet/`](https://github.com/Unlisted-Org/unlisted/tree/main/tests/program/devnet) |
| The fixture issuer's scenarios on the canonical basket | [`fixtures/scenarios/`](https://github.com/Unlisted-Org/unlisted/tree/main/fixtures/scenarios) |
| The fixtures against the real mints, field by field | [`fixtures/DIFF.md`](https://github.com/Unlisted-Org/unlisted/blob/main/fixtures/DIFF.md) |
| Fresh-wallet browser runs on devnet, including the whole story on the app's Overview (`2026-09-25-devnet-overview.json`) | [`web/e2e/holder/runs/`](https://github.com/Unlisted-Org/unlisted/tree/main/web/e2e/holder/runs), [`app/e2e/runs/`](https://github.com/Unlisted-Org/unlisted/tree/main/app/e2e/runs) |
| The valuation API against the chain | [`services/valuation/verify/out/`](https://github.com/Unlisted-Org/unlisted/tree/main/services/valuation/verify/out) |
| The share maths as an executable model | [`spec/model/`](https://github.com/Unlisted-Org/unlisted/tree/main/spec/model) |

## What's proven

A summary, grouped the way `evidence/build-proven.py` groups it. Each item links to its signatures on the page that explains it.

1. **The program is deployed on devnet**, and the deployed bytes hash to the same sha256 as the tested build ([The program](/protocol/program/#identity-and-deploy)).
2. **A pause in one name doesn't lock the basket:** on the program's own fixture mints, in a real browser by a fresh wallet on the deployed app (4 of 4 runs), and measured against the valuation API ([The user flow](/product/user-flow/), [Claims](/protocol/claims/#paused)).
3. **A seizure is observed and shared pro rata**, including while a claim is open ([How it works](/product/how-it-works/#seizure-handling), [Claims](/protocol/claims/#a-seizure-while-a-claim-is-open)).
4. **Every other issuer action degrades one leg, not the basket:** frozen vault, transfer hook, display multiplier, and the first half of a fee change ([Claims](/protocol/claims/#every-unavailable-leg-case-signed-on-devnet)).
5. **Deposits work in kind, through a USDC ticket, and through the refund path** ([How it works](/product/how-it-works/#deposits)).
6. **The Jupiter path works against the real PreStocks mints** on a mainnet fork: a 4-transaction USDC deposit, a USDC-mode redemption settled over live routes, and the whole IPO rule ([The protocol flow](/protocol/flow/#transaction-sizes)).
7. **The valuation API matches the chain** ([below](#the-valuation-api-matches-the-chain)).
8. **The fixtures mirror the real mints** ([Architecture](/protocol/architecture/#devnet-fixtures)).
9. **What the issuer has done on mainnet** ([The problem](/product/problem/)).
10. **Symmetry breaks when the issuer acts**, on a mainnet fork with its own program ([The problem](/product/problem/#what-happens-to-a-basket-when-the-issuer-acts)).

### Also on the fixture mints, reversed each time

The fixture issuer ran each action on the **canonical basket** in a window the project granted, then reversed it, and each reversal is confirmed on chain (`fixtures/scenarios/restored-checks.json`):

| Action | Done | Reversed |
|---|---|---|
| Pause / resume (KALSHI) | [`54a2pa92…FpkzZdpg`](https://explorer.solana.com/tx/54a2pa92oBWKxGuvfcJmNjSRAWM34H1ZAdqzDo34yGwxZD7V3dVTC83xDMDLQSjFToA7tcUZVjjMvvKdFpkzZdpg?cluster=devnet "slot 503682672") | [`3BabkbVu…kCC4sKVF`](https://explorer.solana.com/tx/3BabkbVuCN8Rv2DMtrfsvQpawZqZ7sZL8PEAQsem1tzE5AYXYGTNLvNQUCywsGpRwUWak12ffkx5e5HKkCC4sKVF?cluster=devnet "slot 503682900") |
| Hook on / off (FIGUREAI) | [`4voJ5Vc2…s5uVVy7r`](https://explorer.solana.com/tx/4voJ5Vc2mLkm3jWSgyr5SckTcVyYD8MYmKotn78Z3ahppsPpbg91wxzro1VHyFMPqMdPMSd9W3MxaQAEs5uVVy7r?cluster=devnet "slot 503683172") | [`5zLhSWAs…S8bDaHng`](https://explorer.solana.com/tx/5zLhSWAskcctZuX1iSDvAxvSUGcuQ3BwtJzinaG1XvQSb5DLh6V5LHqYCRSA3HNKapia6woEzphV1fqBS8bDaHng?cluster=devnet "slot 503683241") |
| Default account state frozen / back (OPENAI) | [`24is8M9M…mzZ71i8L`](https://explorer.solana.com/tx/24is8M9MahYSr8KVDTZoNWERwbNishVMu2QbgehRJhWPwxoChx2JNN9jBMFtC2RMfEvqhNzbnuWtifiYmzZ71i8L?cluster=devnet "slot 503683345") | [`2ZupaV4y…7ZVvL5Cy`](https://explorer.solana.com/tx/2ZupaV4ymEzfeVgax7WCGBvvXzFT7BAxeQ3cWLuV7Lvaq8dqdXDy9NDtwJEFqc7ArxdLJCbEGHSXYprX7ZVvL5Cy?cluster=devnet "slot 503683415") |
| Multiplier 2 / back to 1 (NEURALINK) | [`4NmACHtU…7iXwBhse`](https://explorer.solana.com/tx/4NmACHtUjeiULrRaShJAf7crCD26ayiTxtMsFUpECia1ZSViuakP9ZWy3UK1jRV7KxVBrsRZ3FzYSxxG7iXwBhse?cluster=devnet "slot 503683698") | [`4A4hhYzd…G6iUVBUG`](https://explorer.solana.com/tx/4A4hhYzd37wxcjorFZv5VQ5JjWHq6FW6pKVMWGXXUZoVKpfYARFswsMKpo4T1GYY6qzScupkhPHDzU79G6iUVBUG?cluster=devnet "slot 503684784") |
| Freeze / thaw a stand-in vault (ANTHROPIC) | [`4vzAdrE7…4Njazwsd`](https://explorer.solana.com/tx/4vzAdrE7iahMLcs5W2G4YsfaQ6grKLPHPBLPyzNCiLLHBzHi94afzW6xMS3nsekWZCK6szqtF7vsu8bV4Njazwsd?cluster=devnet "slot 503677692") | [`57EMkMZx…ksWm7KWP`](https://explorer.solana.com/tx/57EMkMZxSsBBxD7mqmW5rm6rXMPihDSHcfYgupwMnhd8NhmzCbwq5fcHodpjsta9suRzWmbp9vgj8oNXksWm7KWP?cluster=devnet "slot 503677792") |

The fixture fee change 100 → 300 bps, scheduled for devnet epoch 1167 to mirror mainnet's epoch 1043: [`2weWhQfG…kXNtGjVR`](https://explorer.solana.com/tx/2weWhQfGSWZZ7Df5J1dECSdBSBuCDYw763aV1YSvBmHp7xtUXCcBnFDCqAsDAW1K659JaZ6ZhVWUvVHVkXNtGjVR?cluster=devnet "slot 503677892").

### The refund path

A USDC ticket that lands three legs and is then abandoned returns everything (`tests/program/devnet/refund-path.json`):

| Step | Transaction |
|---|---|
| Three legs land through `fixture_amm` | [`4iLFvrrG…gfZ48p67`](https://explorer.solana.com/tx/4iLFvrrGcWHKwQkB57YcrrpzL59WVoMdwTfcFp5eMFC7XFpkYb8B6mkAwJoSJPyYNZ2ce2yEoBQRZ93MgfZ48p67?cluster=devnet "slot 503692086") |
| Broken version (a): abort before unwinding is refused (`LegsStillLanded`) | simulated, no signature |
| Unwind OPENAI, ANTHROPIC and NEURALINK back to USDC | [`v5LVkVhA…VAs3KpqQ`](https://explorer.solana.com/tx/v5LVkVhAxy6ppSUGVE5sne6beNYwbNXhz8CuWCK3N69m7MSp6McAiwALNsWYHjWgiSf6ZnFRQSkcyraVAs3KpqQ?cluster=devnet "slot 503692122"), [`3kAEUJdC…1CRFLjCJ`](https://explorer.solana.com/tx/3kAEUJdC1ZwBsn7KZaMnzpzssHz7ELhkuTFK3MkH9pZAhDU5VMapHXmjZesqdn2mk4ggrb1jfbPikkiR1CRFLjCJ?cluster=devnet "slot 503692144"), [`q6gTQRRg…gCPDRiff`](https://explorer.solana.com/tx/q6gTQRRgXTWktvpaMM1Q7qGx7rMDVRZdmZhHF7BnWhywkRXZ7XPWdAEW5USBBZCYYLs6RfmghaHt5wjgCPDRiff?cluster=devnet "slot 503692176") |
| `abort_deposit` returns the escrow and every lamport of rent to the owner | [`4mnuhQAB…ZxQhmKgc`](https://explorer.solana.com/tx/4mnuhQABT6zLdBDiZ7NbsbUP51fThBtR8br967Qbo9k39HzLye7WtB7n1MrdY7yxW51fnxCvrsZBsk4cZxQhmKgc?cluster=devnet "slot 503692226") |

Broken version (b), an abort that skips a ticket-owned account, is **accepted** by the program. That is the known limitation on [Security and assumptions](/trust/security/#known-limitation-a-ticket-owned-account-left-out-of-an-abort).

## The valuation API matches the chain

- **`/v1/basket` against an independent decode of the account bytes:** all 114 fields match, bracketed at devnet slots 503,684,885–503,685,032 and mainnet slots 450,164,321–450,164,414.
- **`/v1/quote/redeem` against a real in-kind redemption, to the unit on every leg:** [`5xn1xzpT…9yfcTPJW`](https://explorer.solana.com/tx/5xn1xzpTZWoXkZVt55cgtqXSej4ELfcYC6QSQJwCgNwq9DArjToQ9A3KHRY7x7gMPf9XNJaUVbYvA7Gs9yfcTPJW?cluster=devnet "slot 503682599"). The paused-leg case is on [Claims](/protocol/claims/#checked-against-the-valuation-api).
- **A multiplier change moves display fields only, and only after its effective time:** read at slots 503,683,466, 503,683,739 and 503,684,596.
- **`sell_now` against mainnet `simulateTransaction`:** 7 of 7 legs within 0.1%.
- **Each of these fails when broken on purpose:** reading the stored multiplier instead of the effective one, rounding up, and allowing Manifest routes. The failing outputs are the `*MUTATION*` and `sell-sim-negative-*` files in `services/valuation/verify/out/`.

## Supporting evidence (local, not proof)

These were each seen to fail against a broken version, and they support the proofs above, but they ran locally, so they aren't proof by the definition at the top:

- **The reference model:** 17 property tests in `spec/model/`, all passing. Deliberately breaking the rounding, the loss index or the claim path makes them fail.
- **The program's LiteSVM suite,** run against the real `basket.so`: 34 of 34 pass, and each of 4 mutants (redeem rounds up, ticket escapes shortfall, pay the paused leg, no loss index) makes at least one test fail.
- **The SDK:** 35 of 35 unit tests pass, and three SDK mutants are each killed. One (open tickets ignoring the loss index) first survived, and was killed by a test added for it.

## Not yet proven

- **The redemption under the new fee, after devnet epoch 1167.** The fee change is scheduled on chain; the redemption can only run once the epoch begins.

## Re-verify everything yourself

- **Every signature on these docs** is checked by the docs' verification script (`docs-site/scripts/verify-sigs.mjs`): each must come from a committed record, be finalized without error on its network, and land at the slot the page states.
- **The landing page's evidence:** `node web/scripts/verify-evidence.mjs` checks every signature in `web/lib/evidence.json`. Run on 2026-09-25: 36 signatures finalized without error, 24 at their recorded slot.
- **The whole proven list:** `evidence/build-proven.py` rebuilds it from the records and re-checks every signature it cites, plus every signature in every devnet record it links, with `getSignatureStatuses`. It writes nothing if any signature is missing, failed or not finalized.

  Run on 2026-09-25 at 13:44 UTC, from `main` at `92fe09c`: **163 devnet signatures and 11 mainnet signatures**, all finalized without error, checked at devnet slot 504,015,250 and mainnet slot 450,369,757. An earlier version of the script read records from agent branches that had been deleted; that is fixed on `main`.

<div class="sources">

Sources: `docs/specs/00-agent-split.md` (*What "proven" means*); `evidence/README.md`; `evidence/build-proven.py` and its output of 2026-09-25 13:44 UTC; `web/scripts/verify-evidence.mjs`; `fixtures/scenarios/*.json`; `tests/program/devnet/refund-path.json`; `services/valuation/verify/out/`.

</div>
