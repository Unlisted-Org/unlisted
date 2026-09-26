---
title: Getting started
description: Open the devnet app, and reproduce the proofs yourself, from the share-maths model to the Symmetry fork and the fresh-wallet browser flow.
---

## Open the devnet app

The app is at **[unlisted-basket.vercel.app/app](https://unlisted-basket.vercel.app/app)**. It runs on **devnet only**, against the canonical basket over the seven fixture mints; it refuses any other cluster. The values it shows are priced from the mainnet market for the real tokens, and it says so next to every value.

The landing page, [unlisted-basket.vercel.app](https://unlisted-basket.vercel.app), tells the story in five sections, and [/evidence](https://unlisted-basket.vercel.app/evidence) lists every transaction behind it.

To try it:

1. **Connect a wallet** set to devnet, with a little devnet SOL for fees ([faucet.solana.com](https://faucet.solana.com)). See [Wallet connection](/app/wallet/).
2. **Get test tokens** on the Overview: 50 fixture USDC and about $20 of each company, once per wallet.
3. **Buy in** on the Overview.
4. **Pause a company** with the issuer control at the bottom of the Overview. The demo passcode, `fjord-basalt-meadow-339`, is already filled in. It acts only on the devnet fixture mints, never PreStocks' real tokens. A pause is global, so please resume what you pause when you're done.
5. **Redeem** while it's paused: six companies pay now and the paused one becomes a claim. Then **Resume**, and **Settle** the claim on its tile.

What each part of the screen does is on the [Dashboard guide](/app/dashboard/).

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

`build-proven.py` passed on 2026-09-25 at 13:44 UTC, from `main` at `92fe09c`: 163 devnet and 11 mainnet signatures, all finalized without error ([Evidence](/trust/evidence/#re-verify-everything-yourself)).

### Reproduce the Symmetry failure

Symmetry's real program, on three fresh local forks of mainnet (baseline, pause, seizure). Needs [`surfpool`](https://github.com/txtx/surfpool) (tested with 0.12.0) and Node 20 or later:

```sh
cd evidence/symmetry-fork; ./run.sh
```

It starts a fork on port 8899 for each scenario, runs it, stops the fork, and writes `out/baseline.json`, `out/pause.json` and `out/seize.json`. By default the fork reads mainnet state from the public RPC; set `DATASOURCE` to use another. The live mainnet comparison of Symmetry's records with its balances is `node mainnet-recon.js`.

What to expect is on [The problem](/product/problem/#what-happens-to-a-basket-when-the-issuer-acts): with one constituent paused, the shares are burned and the redemption pays nothing; after a seizure, every redemption fails. The fork's signatures exist only on the fork, so they differ from run to run.

### The fresh-wallet flow in a browser

`web/e2e/holder/flow.spec.ts` is the test behind [The user flow](/product/user-flow/). In a real browser, on the app's Overview, it generates a new wallet, takes the app's test tokens, buys in, pauses ANTHROPIC with the issuer control, redeems (six legs paid, one claim), resumes, and settles the claim on its tile; then it deposits USDC on Buy and checks Claims and Basket. It records every signature in `web/e2e/holder/runs/`.

The command the project uses, from `web/e2e/holder/repeat.sh` (run from `web/`, after `npm install` there and in `sdk/`, and `npm run test-wallet`, which bundles the test wallet):

```sh
N=1 E2E_BASE_URL=https://unlisted-basket.vercel.app e2e/holder/repeat.sh
```

These docs didn't re-run it. **It needs the project's own secrets, so it can't run from a fresh clone:** a dedicated devnet RPC key read from the repository root's `.env.local`, and the project key that sends the fresh wallet its SOL. None of them is committed. To check the flow without running it, read the recorded runs: every signature in `web/e2e/holder/runs/2026-09-25-devnet-overview.json` is on devnet, and [The user flow](/product/user-flow/) links those of one run.

<div class="sources">

Sources: `README.md` (*Reproduce*); `evidence/symmetry-fork/README.md`, `run.sh`; `web/README.md`; `web/e2e/holder/flow.spec.ts`, `harness.ts`, `repeat.sh`; `web/app/config.json/route.ts`; `web/app/app/_holder/views/Overview.tsx`; `web/app/api/faucet/route.ts`.

</div>
