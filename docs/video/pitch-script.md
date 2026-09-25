# Pitch video: shot list and voiceover (target 2:30, hard limit 3:00)

For: Colosseum Crypto World's Fair judges. This is the most important element of the submission.

**Recording:** you record in Screen Studio: screen first, voice separately or live, your choice.
- **Browser:** one window at 1440×900, zoom 100%, dark theme, no bookmarks bar, no other tabs visible.
- **Site:** https://unlisted-basket.vercel.app. Its Docs link opens https://unlisted-docs.vercel.app.
- **Brackets** in the voiceover are delivery notes, not words to say.

**Rules this script keeps:**
- Every spoken figure has its source in the right-hand column.
- Nothing is called cheaper than buying the seven tokens; the worst cost figure comes first.
- PreStocks' reply is described, not quoted, until the verbatim text is in the repo.
- A pause is never claimed as something the issuer has done. It is a power it holds.

## Segments

| # | Time | Screen and cursor | Voiceover | Source |
|---|---|---|---|---|
| 1 | 0:00–0:14 | **Landing hero, top of the page.** Load the page on camera: the receipt card rises and its rows land (about 1.5 s). Cursor still, off to the right. | [calm, direct] "OpenAI. Anthropic. Five more pre-IPO companies. On Solana they trade as tokens. And every one of those tokens has an issuer who can pause it, seize it, or re-price it. Whenever it wants." | `docs/risks.md` intro and §2 |
| 2 | 0:14–0:42 | **Scroll to "The problem".** Hold on the three cards, left to right. On "twenty-nine", move the cursor to the seizure card; on "three changes", to the fee chart; on "nine minutes", to 9:41. | "This isn't hypothetical. [beat] In September 2025 the issuer emptied twenty-nine holders' accounts to zero. No memo. This September it changed the transfer fee three times in sixteen days: zero, fifty, a hundred, three hundred basis points. It changed OpenAI's display multiplier with nine minutes and forty-one seconds of notice. [slower] And PreStocks told us there is no channel that announces any of this in advance." | `risks.md` §1, §2, "PreStocks' reply" item 3 |
| 3 | 0:42–1:08 | **Scroll to "Basket protocols break".** Stop with the terminal fully in view; the run starts by itself. Let the first case (Symmetry, pause) play through, then the third (Symmetry, seizure) as it comes. Don't click anything. | "So what happens to a basket of these tokens when the issuer acts? We took Symmetry, a live Solana basket protocol, and ran its own program on a copy of mainnet. [beat] Pause one token mid-redemption: your shares are burned, and you receive nothing. Seize one token from the vault: every redemption after it fails. For everyone." | `evidence/symmetry-fork/README.md` §2–3 |
| 4 | 1:08–1:50 | **Cut to the app, Overview** (footage from the demo recording, sped up 2× where it waits). Show, in order: <br>• the issuer pausing Anthropic, with the tile turning red; <br>• Redeem, with six tiles showing what they pay and Anthropic saying "becomes a claim"; <br>• the tiles after redemption, Anthropic holding "Your claim"; <br>• Resume, and Anthropic's tile switching to "Pays … now"; <br>• Settle, and the claim clearing. | [warmer, this is the turn] "Unlisted is built for exactly that moment. Seven companies, held at equal weight, one token. When the issuer pauses one, you can still redeem. [beat] The other six pay out immediately. The paused one becomes a claim on that company, with its gains and its losses, and when the pause lifts, the claim pays out. A seizure is caught on chain and shared by every holder, instead of breaking the basket." | Spec 01; `web/e2e/holder/runs/2026-09-25-devnet-overview.json` |
| 5 | 1:50–2:02 | **Back on the landing page, the cost section.** The $10,000 row, 7.9%, is visible. Cursor rests beside 7.9%. | [plain, no apology] "It isn't cheaper than buying the seven yourself. At the three-hundred-basis-point fee the issuer has just set, a ten-thousand-dollar round trip costs about seven point nine percent. We put that on the front page." | `risks.md` §1; landing Cost |
| 6 | 2:02–2:22 | **Scroll to "What we don't claim", then to /evidence.** Hover one signature, but don't click (clicking opens the explorer, which can load slowly). | "We asked PreStocks. They told us they have no objection, including to a mainnet version. That's not an endorsement, and we don't say it is. They also confirmed the basket's vault is treated like any other holder, which is the assumption this whole design is built on. [beat] Every claim you've heard links to a finalized transaction." | `risks.md`, "PreStocks' reply" items 1–2; `/evidence` (36 signatures) |
| 7 | 2:22–2:32 | **Back to the hero,** or the logo on a plain dark frame. Show the URL on screen. | [slow, land it] "Unlisted. Seven pre-IPO companies. One token. And you can always get your share out." | |

**Word count:** about 330 spoken words. At a relaxed 140 words a minute that is 2:21, which leaves ~10 s of breathing room.

## If a segment runs long

Cut in this order, and don't speed up the read:
1. **Segment 6:** drop "including to a mainnet version" and the vault sentence (saves about 8 s). Keep "not an endorsement".
2. **Segment 2:** drop the fee steps ("zero, fifty, a hundred, three hundred basis points"), keeping "three times in sixteen days" (saves about 4 s).
3. **Segment 3:** drop "a live Solana basket protocol" (saves about 2 s).
4. **Segment 4:** speed the waits in the footage up to 3×, never the voice.

**Never cut:** the Symmetry failure, the six-plus-a-claim moment, or the cost line.

## Avoid on camera

- **Explorer pages.** Don't click through to Solana Explorer: it sometimes shows "Not Found" for a few seconds before loading. Hover signatures instead.
- **A cold Basket page.** If you show it, open it once before recording so the valuation service is warm.
- **Epoch 1167.** It is due around 03:00 UTC on 2026-09-26.
  - **Before it,** a yellow "Transfer fee change scheduled: 100 → 300 bps at epoch 1167" banner sits on the app. That's fine; it shows the watcher working.
  - **After it,** there's no banner, and the fee is 300 bps.
  - **Either way,** the 7.9% line is right: it is computed at 300 bps.
- **Mainnet timing.** On mainnet the 300 bps fee is scheduled, not yet live: it takes effect at mainnet epoch 1043, around 04:52 UTC on 2026-09-26, and it is 100 bps until then. That's why the line says "the issuer has just set", not "today's fee".
- **The "Basket protocols break" section plays once per page load.** If you need another take, reload the page, don't scroll back.
- **Reduced motion.** Don't record with "Reduce motion" on in macOS: the card and the terminal would appear already finished.
- **Pause wording.** Don't say the issuer has paused a token on mainnet. It hasn't been seen doing that.

## Check before export

- Every number spoken equals the number on screen or in its source.
- The app footage in segment 4 is the demo recording, unedited except for speed.
- The URL shown is unlisted-basket.vercel.app.
