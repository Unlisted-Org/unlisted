---
title: Getting started
description: Open the devnet app, and reproduce the proofs yourself, from the share-maths model to the Symmetry fork and the fresh-wallet browser flow.
---

## Open the devnet app

The app is at **[unlisted-rosy.vercel.app/app](https://unlisted-rosy.vercel.app/app)**. It runs on **devnet only**, against the canonical basket over the seven fixture mints; it refuses any other cluster. The values it shows are priced from the mainnet market for the real tokens, and it says so next to every value.

The landing page, [unlisted-rosy.vercel.app](https://unlisted-rosy.vercel.app), tells the story in five sections, and [/evidence](https://unlisted-rosy.vercel.app/evidence) lists every transaction behind it.

The app is being restructured as these docs are written. A guide to what you see in it, and how to connect a wallet, will follow on their own pages once the new version is deployed.

## Reproduce the proofs

Clone the repository first:

```sh
git clone https://github.com/Unlisted-Org/unlisted.git
cd unlisted
```

Nothing below signs a mainnet transaction. Everything that writes runs on devnet or on a local fork.

### The share maths (no network needed)

```sh
python3 -m unittest discover -s spec/model -v
```

17 property tests of the reference model: rounding, seizure, partial redemption and the IPO rule. They passed when these docs were written.

### Every signature, on chain (read only)

```sh
node web/scripts/verify-evidence.mjs    # the landing page's 36 signatures
python3 evidence/build-proven.py --out /tmp/proven.md   # the whole proven list
```

`verify-evidence.mjs` passed on 2026-09-25: 36 signatures finalized without error, 24 at their recorded slot.

<div class="unverified">

**Known issue:** `evidence/build-proven.py`, as committed on 2026-09-25, reads records from agent branches that have since been deleted and stops with a `git show` error. Reading every record from the current checkout, the same checks passed: 148 devnet and 11 mainnet signatures, all finalized without error ([Evidence](/trust/evidence/#re-verify-everything-yourself)). The fix has been reported.

</div>

### Reproduce the Symmetry failure

Symmetry's real program, on three fresh local forks of mainnet (baseline, pause, seizure). Needs [`surfpool`](https://github.com/txtx/surfpool) (tested with 0.12.0) and Node 20 or later:

```sh
cd evidence/symmetry-fork; ./run.sh
```

It starts a fork on port 8899 for each scenario, runs it, stops the fork, and writes `out/baseline.json`, `out/pause.json` and `out/seize.json`. By default the fork reads mainnet state from the public RPC; set `DATASOURCE` to use another. The live mainnet comparison of Symmetry's records with its balances is `node mainnet-recon.js`.

What to expect is on [The problem](/product/problem/#what-happens-to-a-basket-when-the-issuer-acts): with one constituent paused, the shares are burned and the redemption pays nothing; after a seizure, every redemption fails. The fork's signatures exist only on the fork, so they differ from run to run.

### The fresh-wallet flow in a browser

`web/e2e/holder/flow.spec.ts` is the test behind [The user flow](/product/user-flow/). In a real browser it generates a new wallet, deposits in kind and with USDC, has the fixture issuer pause ANTHROPIC, redeems (six legs paid, one claim), has the issuer resume, and settles the claim. It records every signature in `web/e2e/holder/runs/`.

The command the project uses, from `web/e2e/holder/repeat.sh` (run from `web/`, after `npm install` there and in `sdk/`, and `npm run test-wallet`, which bundles the test wallet):

```sh
N=1 E2E_BASE_URL=https://unlisted-rosy.vercel.app e2e/holder/repeat.sh
```

These docs didn't re-run it. **It needs the project's own devnet keys, so it can't run from a fresh clone.** The pause and resume are the issuer's actions: on devnet they're signed by the fixture issuer key, which isn't in the repository. `repeat.sh` also reads a dedicated devnet RPC key from the repository root's `.env.local`, which is never committed, and funding the fresh wallet uses a project key. To check the flow without running it, read the recorded runs: every signature in `web/e2e/holder/runs/2026-09-25-devnet.json` is on devnet, and [The user flow](/product/user-flow/) links each one.

<div class="sources">

Sources: `README.md` (*Reproduce*); `evidence/symmetry-fork/README.md`, `run.sh`; `web/README.md`; `web/e2e/holder/flow.spec.ts`, `harness.ts`, `repeat.sh`; `web/app/config.json/route.ts`.

</div>
