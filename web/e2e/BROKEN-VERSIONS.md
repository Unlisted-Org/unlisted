# Landing page checks: broken versions first

Each check in `landing.spec.ts` was run against a deliberately broken page, and seen to fail at the intended assertion, before the real run was relied on. Run a broken version with `BROKEN=<name> npx playwright test`.

Recorded on 2026-09-25, against a production build (`next start`), in Chromium from `../.playwright-browsers`.

| `BROKEN=` | What it breaks | Result | Failing output |
|---|---|---|---|
| `wide` | a 2000px-wide element inside the cost section | 5 of 6 fail (the reduced-motion test doesn't check width) | `page scrolls sideways: scrollWidth 2000 > clientWidth 1440`, and `> 390` |
| `hide` | the signatures section hidden | all 4 layout tests fail | `expect(locator).toBeVisible()` on `#proof-title` (at 1440 the wait for a hidden element runs to the 2 min timeout) |
| `motion` | a 60s animation on the headline that ignores reduced motion | the reduced-motion test fails | `running animations under reduced motion: H1` |
| `blank` | the terminal transcripts emptied until replayed | the complete-at-rest test fails | `terminal lines at rest — Expected: >= 20, Received: 0` |

The `motion` and `blank` runs also failed the 390 tests. That was a real defect, not the injected break: the cost section's grid column widened to fit the table's minimum width, so the page scrolled sideways (`scrollWidth 438 > clientWidth 390`). It was fixed by giving the grid's children `min-width: 0`.

**Real run after the fix:** 6 of 6 pass. Screenshots are in `e2e/shots/`.

Also enforced at build time: `npm run build` runs `scripts/verify-evidence.mjs` first. That script fails unless every signature on the page is finalized, without error, on its network, and at its recorded slot. Its broken versions both failed:
- a slot off by one;
- two signatures swapped between rows.

## Logged-out link check (`LINKS=1 npx playwright test e2e/links.spec.ts`), 2026-09-25, after the repo went public

- **Explorer:** all 36 evidence signatures open on explorer.solana.com in a fresh browser context (no cookies, no wallet) and show Success and Finalized. Mainnet signatures use the default cluster; devnet ones use `?cluster=devnet`.
- **GitHub:** all 16 github.com links on the page return 200 to an unauthenticated request.
- **Broken versions (`BROKEN_LINKS=1`):** both checks failed, each on exactly the injected item:
  - a well-formed signature that doesn't exist on chain → `devnet 4uRBN9XK…: not found`, while the 36 real ones passed;
  - a record path that doesn't exist → `404 …/docs/does-not-exist.md`.

## Section 3 swapped to the Pro `feature-section-with-terminal` frame

The complete-at-rest check now requires two things at rest: the selected transcript in full, and all four outcomes (Symmetry and Unlisted, pause and seizure) visible. `BROKEN=blank` still fails it (`terminal lines at rest`), and `BROKEN=wide` still fails the width check. Real run: 6 of 6 pass.

# Holder app (`/app`) checks: broken versions first

`e2e/app.spec.ts`, recorded 2026-09-25 against a production build, with the valuation API serving the canonical devnet basket.

| `BROKEN=` | What it breaks | Result | Failing output |
|---|---|---|---|
| `wide` | a 2000px element inside the legs panel | all 4 layout tests fail | `page scrolls sideways: scrollWidth 2224 > clientWidth 1440` |
| `hide` | the three-values panel hidden | all 4 layout tests fail | `value-sell-now`: element is not visible (it waits out the timeout) |
| `motion` | an animation inside the app | the no-motion test fails | `animations running in the app` |
| `404` | the landing page's "Open app" link pointed at a missing route | the link test fails | `GET /apps` status not 200 |

**Real run:** 12 of 12 pass, landing and app together.

**One bad test was found and replaced while doing this.** The first version of the "Open app" check waited for a full-page navigation. Next's `<Link>` navigates client-side and never makes one, so that test could only time out, whatever the page did. It now loads the link's target directly (it must answer 200 and be the app), then follows the link in the page.

# The fresh-wallet devnet flow in the new app (`e2e/holder/flow.spec.ts`)

This is Agent B's flow, ported to `/app`, and run on 2026-09-25 with the valuation API connected. The record is in `e2e/holder/runs/2026-09-25-devnet.json`, which holds every attempt, failures included.

**Attempt 1 failed** at the pause banner. The ported spec used Playwright's default 5 s wait, while B's config allowed 60 s, and the app's first devnet read after a reload is slower than 5 s. The harness resumed ANTHROPIC and returned the SOL. Fixed by restoring B's 60 s wait.

**Attempt 2 failed** at the USDC ticket's first transaction: `Blockhash not found` from the load-balanced public RPC. The in-kind deposit before it had succeeded. The SOL was returned.

**Attempt 3 passed** (7.9 min), with fresh wallet `GM7UuYmhEToqk6Di1hNGERN16znT4Q2wgHFDJK9DpqT5`:
- **Deposit in kind:** 79,902,598 shares minted, exactly as the app predicted.
- **USDC ticket:** 2 transactions; afterwards the ticket owns no token accounts.
- **Redemption with ANTHROPIC paused:** 6 legs paid, 1 claim.
- **Settlement after the resume:** 4,454,709 received, equal to the app's estimate.
- **Approvals:** one wallet approval per flow.
- **Verification:** all 12 signatures are finalized without error, and ANTHROPIC was confirmed unpaused afterwards.
- **Screenshots:** `e2e/holder/runs/2026-09-25-devnet-*.png`, showing the claim open, then settled.

**Broken version, run on the new UI:** B's `price-panel-not-api` mutant, applied to the ported `Panels.tsx` (the sell-now card shows the API's last-trade figure). It was killed at the intended assertion: `Expected: "match"`, `Received: panel ["698.977388","698.977388","650.299763"]`. The mutant was reverted, and the file was confirmed byte-identical to B's original. B's other mutants target the shared SDK or localnet-only flows; they were killed against B's UI on 2026-09-24 (`app/e2e/runs/2026-09-24-localnet-mutations.json`), and the SDK code they mutate is unchanged.

# Sending with retries (`e2e/send.spec.ts`), and the exact-revert mutant tool

**Retry logic** (`app/app/_holder/send.ts`). The app now takes a `finalized` blockhash. On a transient RPC error (`Blockhash not found`, 429, 5xx, timeouts) it re-sends the same signed bytes, while that blockhash is still valid.
- **Broken version:** `SEND_BROKEN=1` allows one attempt. The transient case fails with `Rejected: … Blockhash not found`.
- **Real run:** all 3 pass:
  - a transient error is retried and succeeds;
  - a program error (`0x1771`) is never retried;
  - an expired blockhash stops the retries and asks for a new signature.

**`scripts/mutant.mjs`** replaces hand-reverted mutants:
- It refuses a target that occurs more than once, which was the slip where a revert matched a second identical line.
- It restores the original bytes, then checks sha256.
- Checked on a scratch file:
  - an ambiguous target is refused, with the file untouched;
  - a killed mutant and a survived mutant are both restored, sha256 identical;
  - an interrupt (SIGTERM) restores at once and exits 130;
  - a hard kill (SIGKILL) leaves `<file>.mutant-backup` for recovery.
- The first version used a blocking `spawnSync`, so an interrupt was only handled after the command ended and was misreported as "survived". It was fixed with an async spawn and re-tested.

# Restructure (2026-09-25): five-section landing, `/evidence`, four-thing app

Every figure and signature survives the move. The evidence spec proves it: all 36 signatures in `lib/evidence.json` must be on `/evidence` as explorer links.

| Spec | `BROKEN=` | What it breaks | Failed at |
|---|---|---|---|
| landing | `company` | one of the seven names removed from the hero | `the seven companies in the hero` |
| landing | `hide` | the survival section hidden (retargeted from the removed `#proof`) | the section's visibility (timeout) |
| landing | `wide`, `motion`, `blank` | unchanged | as before |
| evidence | `dropsig` | one signature's row removed | `signatures missing from /evidence: 2smHrk8U` |
| evidence | `wide` | a 2000px element | `page scrolls sideways: 2112 > 1440` |
| app | `expanded` | the details panels opened | `details panels open by default` (7 received) |
| app | `allvalues` | the value expander opened by default | `last trade folded by default: Expected hidden, Received visible` |
| app | `costfirst` | the cost box moved above the buy action | `Expected "button, then cost", Received "cost, then button"` |
| app | `nopaging` | 11 extra entries injected into an event list | `entries shown before 'Show more': Expected <= 10, Received 21` |
| app | `wide`, `motion`, `404` | retargeted from the removed `#legs` to `#overview` | as before |

**Real run:** 22 of 22 pass (landing, evidence, app, send).

**Three broken versions were themselves broken at first,** and were each fixed and re-run before being relied on:
- `expanded` injected CSS, which can't override Tailwind's layered `!important` `[hidden]` rule, so it tested nothing. It now removes the attribute.
- landing `hide` targeted `#proof`, which no longer exists on the landing page.
- app `wide` and `motion` targeted `#legs`, which no longer exists.

**Not re-run after the restructure:** app `hide` (the three-values panel hidden). The run hung, and it was stopped rather than waited on. Before the restructure it failed at the intended assertion. It has since been changed to fail fast (20 s), and needs one run.

# App stage (2026-09-25): wallet adapter, flush sidebar, six routes, the demo on the Overview

`e2e/app.spec.ts` was rewritten for the routes. Each broken version below was run first, against a production build, and failed at the assertion named.

| Broken version | Mutation | Failed at |
|---|---|---|
| `merged` | another route's content (`legs-table`) injected into every route | `legs-table on /app: Expected 0, Received 1` |
| `centred` | the frame re-centred in a 1440px column | `sidebar left edge at 1920px: Expected 0, Received 240` |
| `uneven` | one sidebar item given 14px extra margin | `sidebar item spacing at 1024px: 37.5, 37.5, 51.5, 37.5, 37.5` |
| `nowallet` | no wallet injected into the browser | `the injected wallet is listed: element(s) not found` |
| `unstyled` | the modal panel forced to another colour | `modal panel colour: Expected "rgb(16, 21, 20)", Received "rgb(44, 45, 48)"` |
| `twobuttons` | a second connect button in the header | `connect buttons in the header: Expected 1, Received 2` |
| `wide` | a 2000px element in the Overview tiles | `/app scrolls sideways: scrollWidth 2284 > clientWidth 1440` |
| `hide` | the Overview's company tiles hidden | `getByTestId('tiles')`: Expected visible, Received hidden (30.6 s) |
| `motion` | an animation on the tiles | `animations running on /app: Expected 0, Received 1` |
| `404` | the landing "Open app" link pointed at `/apps` | `GET /apps: Expected 200, Received 404` |
| `allvalues` | the Basket value expander opened | `last trade folded by default: Expected hidden, Received visible` |
| `costfirst` | the cost box moved above the Buy action | `Expected "button, then cost", Received "cost, then button"` |
| `nopaging` | 11 entries injected into the History issuer list | `entries shown before 'Show more': Expected <= 10, Received 21` |
| `orphan` | the tiles put back on an auto-fill grid (FigureAI was left alone on a second row at 1280px in a live run) | `tile rows at 390px: 4`, not 1 or 7 |

- **Retired:** `expanded`. The Details tabs it opened no longer exist; their contents are now routes, which the `merged` check covers.
- **The old `hide`** (value panel hidden on the previous one-page app) was run once more against the live site, where that layout still ran. It hung again: no result within 280 s, with the test never reporting. That layout is now gone. The new `hide` fails in 30.6 s.
- **One test fault found:** the sidebar check first measured the loading frame's sidebar while the real frame replaced it (`boundingBox` null). It now waits for the real frame, marked by the Connect button. `centred` and `uneven` were re-run against the fixed check and still fail, and the real check then passed three runs in a row.

**Server routes** (`scripts/mutant.mjs`, reverted byte-identical):
- **Passcode gate.** Mutant: `passcodeOk` returns true when no passcode is configured. Killed: `passcode "wrong": Expected 403, Received 503`.
- **A false kill, caught.** The first mutant tried (`return true;` as the first line) did not compile. The build failed before any test ran, and the tool reported the mutant as killed. The check command now runs the build separately and reports `BUILD FAILED` with its own exit code (99), so a broken build can never pass as a killed mutant.

**The devnet flow on the Overview** (`e2e/holder/flow.spec.ts`). It runs the whole story at `/app`, through the app's own controls:
- test tokens from the faucet;
- buy in;
- the passcode-gated issuer pauses ANTHROPIC;
- redeem anyway;
- resume;
- settle on the tile.

It then checks Claims, a USDC ticket on Buy, and the values and multipliers on Basket, with the wallet still connected.
- **Real run:** passed first time, in 1.6 minutes. Every app prediction equalled the independent chain read:
  - shares minted 179,073,207, as predicted;
  - six legs paid exactly as the tiles said;
  - claim units equal to the shares redeemed;
  - settlement 8,522,834, equal to the tile's estimate.
- **Broken version:** the tile reports the gross amount instead of what you receive. Killed at `paid now, exactly as the tile said`: expected 4,554,309, received 4,508,765 (the 1% issuer fee). The harness then resumed ANTHROPIC, and a later on-chain read showed `paused: false`.
- **Real run:** 26 of 26 pass locally: app, landing, evidence, send, the API gate and the tile rows. On the live site, 25 of 25 passed before the tile-row check existed.
- **Live devnet flow,** against https://unlisted-rosy.vercel.app with the Vercel-held fixture key and the Railway valuation API: **3 of 3 passed first time** (116 s, 176 s, 117 s).

# Landing (2026-09-25): a straight hero card, and a scroll-triggered run of the "Basket protocols break" section

What changed:
- **The hero card** is no longer tilted. It plays in once on load (the card rises, the seven rows land in order, the paused company's claim is marked, then the settlement line) and stops. This is CSS only; under reduced motion none of it exists.
- **The "Basket protocols break" section** has no Replay control. The terminal plays once, when it is half in view. The four steps beside it advance in order as it plays, and it stops on the last step without looping. A click on a step shows that step's run in full and ends the automatic run. Under reduced motion every line is printed at once.

Each check was seen failing on its broken version first:

| Broken version | Mutation | Failed at |
|---|---|---|
| `tilt` | the card rotated in 3D (`rotateX(10deg) rotateY(-8deg)`) | `transformed ancestors (reduce)` |
| `nohero` | the card's entrance animations removed | `entrance animations on the hero card: Expected >= 8, Received 0` |
| `replay` | a Replay button added to the section | `no Replay control: Expected 0, Received 1` |
| `blank` | the terminal emptied under reduced motion | `terminal lines at rest: Expected >= 9, Received 0` |
| mutant: never starts | `start={inView && false}` in `versus.tsx` | `steps, in the order they played`: no steps seen |
| mutant: loops | at the end, go back to the first step | `steps, in the order they played`: a fifth step seen |

- **One false failure, fixed.** The first real run flagged the card's `matrix(1, 0, 0, 1, 0, 0)`. That is the identity matrix, the entrance's flat end state. The check now accepts the identity only, and `tilt` still fails against it.
- **Mutants** were applied with `scripts/mutant.mjs` and reverted byte-identical. The check command builds separately, so a mutant that doesn't compile can't pass as killed.
- **Copy:** the disclosures and footer carry PreStocks' reply of 2026-09-25 (no objection, which is not an endorsement; the vault is treated like any holder; no advance notice of changes). The same wording is on the app's Basket route.
- **Real run:** 29 of 29 pass (landing, app, evidence, send).
