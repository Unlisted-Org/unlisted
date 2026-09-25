# Demo video script (target 2:45, limit 3:00)

For: Colosseum Crypto World's Fair judges. It shows the product working, in a browser, on devnet.

**The footage is real.** It's the Playwright recording of the fresh-wallet flow against the live site (`web/e2e/holder/flow.spec.ts`, run with `E2E_VIDEO=1`). A wallet generated for the take does everything in the browser, and every transaction is finalized on devnet. The issuer's pause and resume are done by the fixture issuer and shown as they happen. Two takes, from two separate runs, so there are two sets of signatures to choose from.

| Time | On screen | Spoken |
|---|---|---|
| 0:00–0:15 | `/app`, no wallet connected: the three values and the legs table | "This is Unlisted on devnet: seven tokenized pre-IPO companies in one basket. There's no oracle. The value is shown three ways, each labelled with how old it is: what you'd get selling now, the last trade, and PreStocks' own reference." |
| 0:15–0:35 | The fee-change banner, and the legs table with each leg's multiplier | "Issuer events are banners. Right now a fee rise to 300 basis points is scheduled, and the app says what it costs a round trip." |
| 0:35–1:00 | Connect the wallet; deposit in kind | "A fresh wallet deposits the seven tokens. The app predicts the shares before signing; the program mints exactly that number. One wallet approval." |
| 1:00–1:20 | Deposit ten USDC through a ticket | "Or deposit USDC. A ticket buys each token straight into the vault, and shares mint when all seven have landed. If a leg can't land, everything is refunded." |
| 1:20–1:35 | The issuer pauses ANTHROPIC; its banner appears | "Now the issuer pauses Anthropic." |
| 1:35–2:05 | Redeem; the per-leg preview, then the result: six paid, one claim | "Redeem anyway. Six tokens are paid out now. Anthropic becomes a claim: it's still yours, and it still shares Anthropic's gains and losses." |
| 2:05–2:30 | The issuer resumes; settle the claim | "The issuer resumes. Anyone can settle the claim. It pays exactly what the app estimated." |
| 2:30–2:45 | The transaction log and one explorer page | "Every step is a finalized devnet transaction, and every one is linked." |

## Recording

- **Run:**

  ```sh
  cd web
  E2E_VIDEO=1 N=1 E2E_BASE_URL=https://unlisted-rosy.vercel.app e2e/holder/repeat.sh
  ```

  Do this twice, once per take. The video lands in `web/test-results/**/video.webm`.
- **Voice:** recorded over the footage. Trim waiting time (confirmations), but never cut a result.
