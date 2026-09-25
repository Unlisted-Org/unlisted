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
