# Spec 00: How the work splits

Status: **draft for agreement.** No agent starts until specs 01–03 are agreed.

## Order of work

1. **Specs, one owner (this pass).** Spec 01 (shares and pricing, backed by `spec/model/`), spec 02 (on-chain interface), spec 03 (valuation API). Owned on `main` by the spec owner. After agreement, any change to them goes through the spec owner.
2. **Three agents in parallel.** Each has its own folder and its own branch, and no two agents edit the same file.

| Agent | Branch | Owns (only these paths) | Builds | Consumes |
|---|---|---|---|---|
| **A: program** | `program` | `programs/basket/`, `tests/program/` | The `basket` Anchor program per spec 02. Tests port `spec/model/test_basket_model.py` case for case. | Specs 01 and 02; the fixture mints and `fixture_amm` program id from C (by address, not by code) |
| **B: client and app** | `app` | `app/`, `sdk/` | TypeScript SDK for spec 02's instructions; transaction building for deposit tickets (router routes, `maxAccounts≈30`, 4 legs per transaction, lookup tables); the web app with the three-value price panel, claim display and issuer-event banners | Specs 02 and 03. Mocks A's program and C's API from the examples in the specs until they ship. |
| **C: data and ops** | `ops` | `fixtures/` (mints, `fixture_amm` program, `DIFF.md`, `scenarios/`), `services/valuation/`, `scripts/` | Fixture mints and fixture USDC on devnet, the fixture market, the issuer scenario suite, the valuation API per spec 03, and the issuer-change watcher | Spec 02 for the program's accounts and events; spec 03 |

The spec owner keeps `docs/`, `spec/`, and `evidence/` on `main`.

## Interfaces agreed before building

| Interface | Written in | Producer → consumer | Change rule |
|---|---|---|---|
| Program accounts, PDA seeds, instructions, events, errors | Spec 02 | A → B, C | A publishes the generated IDL as `programs/basket/idl/basket.json`. Any difference from spec 02 is reported to the spec owner, never silently adapted. |
| Share maths | Spec 01 and `spec/model/` | spec owner → A, C | A's program and C's `/v1/quote/redeem` must match the model to the unit on shared test vectors. |
| Valuation API schema | Spec 03 | C → B | The example responses in spec 03 are the contract. |
| Fixture registry (mint addresses, `mirror_of`, fixture USDC, `fixture_amm` program id, fixture-issuer key pubkey) | `fixtures/registry.json` (C) | C → A, B | Addresses only. A and B read it and never write it. |

**Cross-boundary findings are reported, not fixed.** Examples:
- B finds a route that exceeds the CPI depth limit: B reports it to A.
- A finds a spec ambiguity: A reports it to the spec owner.
- C finds a fixture/mainnet field difference: C records it in `DIFF.md` and reports it if it affects A or B.

Reports go in `docs/reports/<date>-<agent>-<topic>.md` on the reporting agent's branch and are raised with the spec owner.

## Git

- Identity inside the repo: `user.name = 1nonlypiece`, `user.email = 190412812+1nonlypiece@users.noreply.github.com`. Every agent's worktree inherits the repo config; don't override it.
- No AI co-author trailers and no "generated with" lines, in commits or PRs.
- Merges to `main` go through the spec owner after the agent's proof bar (below) is met.

## What "proven" means per agent (devnet only; never mainnet)

"Implemented and tested locally" doesn't finish anything. A claim is proven only by one of:
- a **confirmed devnet transaction signature**;
- a **cloned-mainnet fork run** (Surfpool, recorded transcript with the fork slot);
- a flow completed **in a real browser by a wallet created for the test**;
- a figure **read live at a stated slot**.

Before relying on a check, ask what it would do if the thing under test were broken. If the answer is "pass", it isn't a check.

| Agent | Proven when |
|---|---|
| **A** | (1) Every issuer scenario in spec 02 (*Fixtures*) runs against the real `basket` program on devnet with the fixture mints, with a confirmed signature for every step recorded in `tests/program/devnet/<scenario>.json`. Pause mid-redemption gets the most coverage: one leg, several legs, seizure while a claim is open, claim settled after resume. (2) The Jupiter CPI path (`ticket_swap_leg`, `settle_leg_usdc`, `convert_listed_leg`) runs on a **cloned-mainnet fork** against real PreStocks mints and live Jupiter routes, proving the account count and CPI depth. (3) The model test vectors reproduce to the unit. |
| **B** | A fresh wallet, created for the test, completes deposit (USDC ticket and in kind), redemption with a paused leg, and claim settlement **in a real browser on devnet**. Every transaction signature is recorded, and a screenshot shows the claim and then its settlement. Asserting on page text that also appears in static copy doesn't count. |
| **C** | (1) `fixtures/DIFF.md` lists every field difference against mainnet at a stated slot. (2) Each issuer scenario has signed devnet transactions. (3) `/v1/basket` and `/v1/quote/redeem` values match direct RPC reads and a devnet `redeem` transaction's measured payout (spec 03, *Acceptance*). |

"Built, not verified" is an acceptable report. "Done" that isn't done is not.
