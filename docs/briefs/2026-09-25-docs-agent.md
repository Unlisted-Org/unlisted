# Brief: the Unlisted docs site (a separate agent, running in parallel)

You are building Unlisted's documentation site. This brief is everything you need. You report to the spec owner (the main session), not to the user. Do only this job; touch nothing outside your folder.

## What Unlisted is

Unlisted is a basket of seven tokenized pre-IPO companies in one token, on Solana: **OpenAI, Anthropic, Neuralink, Anduril, Polymarket, Kalshi and FigureAI**. The tokens are PreStocks, Token-2022 mints issued by PreStocks. They're held at equal weight in a program-owned vault, and the basket issues one share token against them.

**The problem.** The issuer can pause any token, seize tokens from any account (a permanent delegate), change the transfer fee, and change the display multiplier. It has done all four:
- 29 holder accounts emptied on 2025-09-19;
- three fee changes in sixteen days (0 → 50 → 100 → 300 bps, September 2026);
- OpenAI's multiplier changed with 9 minutes 41 seconds of notice.

Other basket protocols fail whole when this happens. Symmetry's own program, run on a mainnet fork, lost the entire redemption, with shares already burned, when one token was paused, and failed every redemption after a seizure.

**The mechanism** (spec 01):
- **A pause doesn't lock the basket.** A redemption pays every available leg immediately. An unavailable leg (paused, frozen, or with an unreviewed transfer hook) becomes a *claim*, which shares that leg's gains and losses and can be settled by anyone once the leg is available again.
- **A seizure is observed and shared pro rata.** The vault's real balance is the truth. `observe` records the shortfall on chain, and every holder bears it; no later depositor makes anyone whole.
- **No oracle.** Deposits and redemptions are computed from the vault's holdings. The app shows three labelled values (what you'd get selling now, the last trade, PreStocks' reference), never one "price".
- **Cost, stated plainly:** never cheaper than buying the seven tokens directly. 5.91% round trip from fees alone at 300 bps; about 6.5% at $10, 7.2% at $1k and 7.9% at $10k with spread.
- **Deployment:** devnet only, against fixture mints that mirror the real ones extension for extension (`fixtures/DIFF.md`).

**PreStocks replied on 2026-09-25** (`docs/risks.md`, section *PreStocks' reply*):
1. They have no objection to the basket, including a future mainnet version, with no conditions. That is **not** an endorsement; never present it as one.
2. A program-owned vault gets no different treatment from any other holder under their pause, freeze and recovery powers. This is the design's founding assumption, now confirmed.
3. **There is no channel where fee or multiplier changes are announced in advance.** Say this plainly: the app reads the mints directly and shows every pending change the moment it exists on chain. The watcher is the only advance warning a holder can get.

The verbatim reply isn't in the repo yet. Don't put quotation marks around anything attributed to PreStocks until it is.

## Reuse the Uncross docs setup

Start from `/Users/jagadeesh/personal/projects/grants/Uncross-docs/docs-site`: Astro 7, `@astrojs/starlight` 0.42, a custom theme and fonts, a sidebar, Pagefind search, and `scripts/verify.mjs`, live at docs.uncross.0xo.in.
- **Copy it; don't modify it.** It belongs to another project.
- Keep the structure and the verification discipline.
- Replace the content, title, logo and colours with Unlisted's. Use the palette in `web/app/globals.css`: green-leaning neutrals, "certificate green" paid `#17664F` / `#43BE93`, claim amber, issuer red, and IBM Plex type. The docs should look like the same product as https://unlisted-rosy.vercel.app.

## Pages

These are adapted to what exists; don't create empty generic pages. If a heading has nothing real behind it, fold it into its neighbour.
1. **Introduction:** what Unlisted is, the seven companies, devnet status, and what PreStocks said.
2. **The problem:** the issuer's powers and what it has done, with the mainnet signatures from `docs/risks.md`.
3. **How it works:** deposits (in kind; USDC ticket), redemptions, the paused-leg path, seizure handling.
4. **Core concepts:** shares, legs, claim units, the loss index, pending sales, the three values. Source: spec 01 and `spec/model/`.
5. **The user flow:** buy in → the issuer pauses one company → redeem anyway (six legs now plus a claim on the seventh) → the pause lifts → the claim pays out. This is the product's thesis; give it a page of its own.
6. **Dashboard guide:** ⚠ wait for the spec owner's message. The app is being restructured right now (separate routes, a single Connect Wallet button, the demo flow in the main view). Write this page, and the wallet page, only after you're told the new app is deployed. Then describe what you actually see at https://unlisted-rosy.vercel.app/app.
7. **Wallet connection:** as for 6.
8. **The protocol flow:** instructions and accounts, from spec 02 and `programs/basket/idl/basket.json`.
9. **Claims and settlement:** from spec 01, spec 02 and the devnet scenario records.
10. **Architecture:** the program, the SDK (`sdk/`), the valuation API (`services/valuation`, spec 03), the web app, and how they talk.
11. **The program:** program id `GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv`, the deploy, errors, events.
12. **Security and assumptions:**
    - what it does and doesn't protect against, from `docs/risks.md`;
    - the SPV dispute, with Anthropic's primary quotes, verbatim, exactly as in `risks.md`;
    - the known limitation in spec 02;
    - devnet only.
13. **Evidence:** how to check every claim; link the site's `/evidence` page and `evidence/build-proven.py`.
14. **FAQ.**
15. **Getting started:** open the devnet app, and how a judge reproduces the proofs (`cd evidence/symmetry-fork; ./run.sh`; the fresh-wallet flow in `web/e2e/holder`).

## Sources (the only sources)

- **Specs:** `docs/specs/00-agent-split.md`, `01-shares-and-pricing.md`, `02-onchain-interface.md`, `03-valuation-api.md`.
- **Risks and outreach:** `docs/risks.md`, `docs/outreach/`.
- **The proven list:** run `python3 evidence/build-proven.py --out /tmp/proven.md` (read-only; it re-verifies every signature on chain), and `web/lib/evidence.json`.
- **Evidence records:**
  - `tests/program/devnet/*.json`, `tests/program/fork/*.json`;
  - `fixtures/scenarios/*.json`, `fixtures/DIFF.md`;
  - `app/e2e/runs/`, `web/e2e/holder/runs/`;
  - `evidence/symmetry-fork/`.
- **The code itself:** `programs/basket/`, `sdk/`, `services/valuation/`.

**Hard rule.** Every claim comes from the code or a committed record. Never invent a number, a signature, a behaviour or a feature. Anything you can't verify, say so on the page ("not verified") or leave it out. If you find something wrong in the specs or the code, **report it to the spec owner; don't fix it**, since those files aren't yours.

## Where you work

- **Worktree:** `/Users/jagadeesh/1nonly/grants/stocklana-worktrees/docs-site`, branch `docs-site`. It's short-lived and gets merged into `main` by the spec owner when you're done.
- **Your folder:** `docs-site/` only. Touch nothing outside it. Don't edit `web/`, `app/`, `sdk/`, `programs/`, `services/`, `fixtures/`, `scripts/`, `docs/` or `spec/`; the spec owner and the other agents own them.
- **Deploy:** a new Vercel project `unlisted-docs` in the "Jagadeesh B's projects" team, using the already signed-in CLI (`npx vercel@60 …`).
  - `vercel link` writes a `VERCEL_OIDC_TOKEN` into a `.env.local` next to where you run it. Delete that file afterwards, and add a `.vercelignore` so no `.env*`, `node_modules` or local state is uploaded.
  - Don't touch any existing Vercel project (Uncross and others share the team).
  - Don't assign a custom domain; the preview URL is fine. Report the URL.
- **Processes:** stop only processes whose PIDs you recorded when you launched them. Never kill by name or port pattern. Check your ports before starting a server.

## Proof bar (the same one the site passes; broken version first)

Using Playwright with `PLAYWRIGHT_BROWSERS_PATH=<worktree>/.playwright-browsers` (project-local; never the shared cache):
1. **Screenshots** of the home page and three content pages at 1440 and 390, light and dark, logged out.
2. **No page-level horizontal scroll** at 390.
3. **Search works:** searching "claim" returns results that include the claims page.
4. **Every internal link on every page resolves:** crawl the built site; a link to a missing page must fail.
5. **Every signature on the docs is finalized** on its network (getSignatureStatuses, as `web/scripts/verify-evidence.mjs` does).

For each check, first run it against a deliberately broken version and confirm it fails; record the mutation and the failing output in `docs-site/BROKEN-VERSIONS.md`. A check never seen failing doesn't count.

## Git

- **Identity** is set in the repo config: 1nonlypiece. Don't change it.
- **No AI attribution anywhere:** no `Co-Authored-By`, no "Generated with", no 🤖. The `commit-msg` hook refuses them anywhere in the message, so don't write those words in a message at all.
- **The pre-commit guard** refuses `.env*`, keypair files and key-shaped strings. Never use `--no-verify`.
- **Push** with the per-command token method in `CONTRIBUTING.md` §3 (`git push origin docs-site`), then verify on GitHub that every commit is 1nonlypiece with no attribution.

## Report

Send the spec owner:
- the deployed URL;
- the page list;
- anything wrong you found in the specs, code or records;
- the proof-bar results, with each broken version;
- your last commit hash.

Then stop. Leave nothing running.
