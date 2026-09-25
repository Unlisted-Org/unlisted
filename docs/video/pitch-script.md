# Pitch video script (target 2:30, limit 3:00)

For: Colosseum Crypto World's Fair judges. The pitch is the most important element of the submission.

**Rules for this script.** Every spoken claim has a source in the repo, listed in the right-hand column. Numbers are said exactly as they appear there. Nothing is called cheaper than buying the seven tokens directly, and the worst cost figure comes first.

Footage is the live site (https://unlisted-rosy.vercel.app) and its linked explorer pages, plus the Symmetry fork transcript. The screen recordings are silent, and the voice is recorded separately.

| Time | On screen | Spoken | Source |
|---|---|---|---|
| 0:00–0:15 | The landing hero, then the real redemption receipt | "Tokenized pre-IPO shares come with an issuer who can pause them, seize them, and triple what it costs to move them. All three have already happened." | `docs/risks.md` §1–2 |
| 0:15–0:30 | "It has already happened": the seizure card, then its explorer page | "On the nineteenth of September 2025, the issuer's permanent delegate emptied twenty-nine holder accounts. No memo, no explanation." | `risks.md` §2, `2smHrk8U…` |
| 0:30–0:42 | The fee chart drawing, then the 300 bps transactions | "This September the transfer fee went from zero to fifty, to a hundred, to three hundred basis points. Three changes in sixteen days, each with about a day and a half of notice." | `risks.md` §1, seven signatures |
| 0:42–0:52 | The 9:41 card, then its explorer page | "OpenAI's display multiplier was changed with nine minutes and forty-one seconds of warning." | `risks.md` §2, `2bNNe87c…` |
| 0:52–1:22 | Section 3: Symmetry's pause run, then its seizure run | "Every basket protocol on Solana breaks when that happens. We ran Symmetry's own program on a copy of mainnet. Pause one of its tokens mid-redemption: your shares are burned, and you receive nothing. Seize one token from the vault: every redemption after it fails, for everyone. Symmetry handles the fee correctly. That's not the problem." | `evidence/symmetry-fork/README.md` §2–3 |
| 1:22–1:55 | Section 3's Unlisted pause run, then the four survival steps with their signatures | "Unlisted pays you out anyway. When the issuer pauses one of the seven, a redemption pays the other six immediately. The paused one becomes a claim, which anyone can settle once it resumes. When the issuer seizes from the vault, the loss is recorded on chain and shared by every holder, pro rata." | Devnet scenarios; the fresh-wallet browser run |
| 1:55–2:10 | The app, the fresh-wallet run: predicted vs minted, estimate vs received | "Every number matches the chain to the unit. The app predicted 79,902,598 shares; the program minted 79,902,598. It estimated the claim at 4,454,709; the wallet received 4,454,709." | `web/e2e/holder/runs/2026-09-25-devnet.json` |
| 2:10–2:25 | The cost table, $10k row first; then the disclosures | "It isn't cheaper. At today's three hundred basis points, a ten-thousand-dollar round trip costs about 7.9%. OpenAI and Anthropic say the underlying share transfers are void; we say so on the page. It runs on devnet, and PreStocks hasn't endorsed it." | `risks.md` §1 and §3 |
| 2:25–2:35 | The signature table, then the logo | "A basket of issuer-controlled tokens that fails one name at a time. Every claim you just heard links to a transaction." | Landing page §5, `evidence/build-proven.py` |

## Recording plan (two takes)

1. **Screen:** capture each shot at 1440×900, dark theme, with the cursor hidden where possible. The landing sections already render complete at rest, so every shot is stable.
2. **Voice:** read the script in one pass per take, aiming for 2:30.
3. **Takes:** record take A, then take B with any line that ran long cut back. Pick after watching both.
4. **Check before export:** every number on screen equals the number spoken, and every signature shown is one of the 36 verified on the explorer.
