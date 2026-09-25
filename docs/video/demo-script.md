# Demo video: shot list and voiceover (target 2:40, hard limit 3:00)

For: Colosseum Crypto World's Fair judges. It shows the product working live, in a browser, on devnet, with your own wallet.

You record it in Screen Studio. The whole story happens on one screen, the Overview at https://unlisted-basket.vercel.app/app:
- buy in;
- the issuer pauses one company;
- redeem anyway: six companies pay out, one becomes a claim;
- the pause lifts;
- the claim pays out.

## Pre-flight (off camera, before every session)

1. **Wallet on devnet.** In Phantom: Settings → Developer Settings → Testnet Mode on → Solana Devnet.
   - Use a wallet with nothing of value in it.
   - Hold at least 0.1 devnet SOL (faucet.solana.com); each take spends about 0.02 SOL in fees and account rent.
2. **Browser.**
   - One window at 1440×900 and zoom 100%.
   - Dark theme (the moon/sun toggle top right).
   - Bookmarks bar hidden, no other tabs.
   - In Screen Studio, turn the keystroke overlay off.
3. **Test tokens (once per wallet).**
   - Open `/app`, connect, and press **Get test tokens** in the Buy in box. You get 50 test USDC and about $20 of each company.
   - It works once per wallet. Don't film it: it's a devnet convenience, and the story doesn't need it.
4. **The issuer control.** Scroll to "Issuer (devnet fixture)" at the bottom of the Overview and type the passcode. The tab remembers it; a new tab needs it again.
5. **Start state.**
   - All seven tiles say AVAILABLE; if Anthropic is paused, press Resume.
   - The Claims item in the sidebar has no count; if it has, open Claims and settle.
   - The Buy in box shows a share amount.
6. **Warm the site.** Open Basket once, wait for the three dollar values, then go back to Overview.
7. **Disconnect** the wallet (address button → Disconnect), so the take can show the Connect button.

**Retakes:** after a full take the wallet holds the seven tokens again, minus fees, so Buy in works for the next take with no new test tokens.

## Segments

**Timings.** The seconds in "On-chain wait" were measured on the live site in the rehearsal: the median, then the slowest in brackets, from click to the app showing the result. They don't include your approval in Phantom, so add 2–4 s for that.

| # | Time | Screen and cursor | Voiceover | On-chain wait |
|---|---|---|---|---|
| 1 | 0:00–0:12 | **Overview, disconnected.** Click **Connect wallet** (top right). The modal lists the wallets your browser has; click **Phantom** and approve. The address appears top right. | [easy, conversational] "This is Unlisted, on Solana devnet: seven pre-IPO companies in one token. One button connects any Solana wallet in your browser." | none |
| 2 | 0:12–0:24 | **Hold on the seven tiles.** Sweep the cursor slowly along the row. | "Each tile is one company the basket holds: OpenAI, Anthropic, Neuralink, and the rest. They're all available right now." | none |
| 3 | 0:24–0:44 | **Buy in.** The amount is filled in already, so don't edit it. Click **Buy in** and approve in Phantom. When "Your last transaction" says ok, point at the share count, then along the tiles, which now say "If you redeem: …". | "I'll buy in with the seven tokens in my wallet. The app works out the shares before I sign, [beat] one approval, and they're mine. Every tile now shows exactly what I'd get back." | 4.6 s (6.3 s) |
| 4 | 0:44–1:04 | **Pause.** Scroll down to **Issuer (devnet fixture)**. Anthropic is already selected; click **Pause Anthropic**. Scroll back up: the red banner, Anthropic's tile turns red, and Buy in now says deposits are refused. | [lean in] "Now the part that breaks other baskets. This control does what the real issuer can do to any of these tokens at any moment: I'm pausing Anthropic. [beat] New deposits stop. Watch what happens to a redemption." | 1.3 s (12.4 s: see "If a step is slow") |
| 5 | 1:04–1:36 | **Redeem.** The Redeem box already holds all your shares and says "6 pay now, 1 becomes a claim". Point at the six tiles' amounts, then at Anthropic's "becomes a claim". Click **Redeem** and approve. After ok: six tiles show the tokens in your wallet, Anthropic says "Your claim: … units" with a grey "Pays when resumed", and the sidebar's Claims shows 1. | [the key moment, slow down] "I redeem everything anyway. [beat] Six companies pay out immediately, exactly the amounts on the tiles. Anthropic can't move, so instead of the whole redemption failing, it becomes a claim on Anthropic: still mine, and still moving with Anthropic's price." | 3.8 s (5.3 s) |
| 6 | 1:36–1:50 | **Resume.** Scroll to the issuer control and click **Resume**. Scroll up: Anthropic is available again, and its tile says "Pays … now" with **Settle** lit. | "When the issuer lifts the pause, [beat] the claim can pay out." | 1.3 s (2.3 s) |
| 7 | 1:50–2:08 | **Settle.** Click **Settle** on the Anthropic tile and approve. After ok, the claim is gone from the tile and the Claims count clears. | "Anyone can settle it; I'll do it myself. [beat] And it pays exactly what the tile said. Every step you've seen is a finalized devnet transaction." | 3.8 s (5.3 s) |
| 8 | 2:08–2:28 | **Claims** in the sidebar: the settled row, with what was received. Then **History**: scroll the issuer activity list. | "The claim's settlement is recorded on chain. [beat] And this is the issuer's activity on the real tokens, read straight from mainnet. PreStocks told us nothing is announced in advance, so this is the only warning a holder gets." | none |
| 9 | 2:28–2:40 | **Back to Overview,** cursor still. | [slow, land it] "Seven companies, one token, and when the issuer acts, you still get your share out." | none |

**Word count:** about 300 spoken words. At 140 words a minute that's 2:09 of speech, leaving about 30 s for waits and approvals.

## If a step is slow

- **Keep talking.** A spare line for any wait: "This is a real transaction on devnet; it lands in a few seconds." Cut the dead air in Screen Studio afterwards. Never cut a result.
- **Pause, over 10 s (it happened once in 20 runs, at 12.4 s).** Say the spare line and wait. The control can't hang any more: it re-signs on a fresh blockhash and answers within 50 s. If the answer is lost, the app reads the chain and shows what actually happened.
- **Any step showing a red "failed":**
  - stop the take;
  - if Anthropic is paused, press Resume;
  - if a claim is open, press Settle;
  - start again from segment 1 with the same wallet.

  Every step can safely be repeated: a failed redemption changes nothing, and Settle can be pressed again.

## If the whole thing runs long

Cut in this order:
1. **Segment 8's History half:** keep Claims (saves 8 s).
2. **Segment 2:** fold it into segment 1's line (saves 8 s).
3. **The waits:** speed them up 2× in Screen Studio.

**Never cut:** segment 5 (six paid, one claim) or segment 7 (the claim pays out).

## Avoid on camera

- **Phantom on mainnet.** If Phantom shows mainnet balances or refuses a devnet transaction, Testnet Mode is off. Check it in pre-flight.
- **Phantom's warnings. Not verified by me.** I can't drive Phantom in the rehearsal (it uses a test wallet), so I haven't seen whether Phantom shows "unable to simulate" or similar warnings for these devnet programs. Do one full dry run with Phantom before recording. If a warning appears, it's cosmetic, but say "devnet" over it rather than leaving it unexplained.
- **Explorer links.** The explorer can show "Not Found" for a few seconds on a fresh transaction. Don't click signatures on camera.
- **Reloading.** The wallet reconnects on its own, but the page flashes "Connect wallet" for a moment. Don't reload mid-take.
- **The Buy in amount.** Leave it as it is: it's sized to what the wallet holds, with headroom. A bigger number shows "doesn't hold enough".
- **Pausing a different company from the one you redeem around.** The script uses Anthropic throughout.
- **Leaving it paused.** At the end of every session every company must be available, or the next visitor's app shows a paused company. The passcode keeps visitors out, so only you can pause.
- **The fee banner.** Until epoch 1167 (due around 03:00 UTC on 2026-09-26), a yellow "Transfer fee change scheduled" banner sits above the tiles. It's accurate and harmless. After it, the banner is gone.

## What's proven about this flow

The rehearsal runs the same flow in a real browser against the live site: test tokens, buy in, pause, redeem everything, resume, settle, then Claims, a USDC buy and the Basket values. Each run uses a fresh wallet and checks every figure the app shows against an independent chain read. The results are in "Rehearsal results" at the end of this file.
