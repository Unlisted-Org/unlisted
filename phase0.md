New project. Phase 0 only — investigate and report. No program code, no frontend, no scaffolding, no git init until instructed.

Git identity: all git activity for this project uses the 1nonlypiece account. Set user.name and user.email explicitly in the repo after git init — the machine's conditional includes only resolve inside an initialised repo, so don't rely on them. No AI co-author trailers and no "generated with" lines, in commits or PRs.

The thesis to test

Token-2022's transfer-fee extension means the amount sent is not the amount received. Tokenized pre-IPO stocks use it: PreStocks charges 100 bps (raised from 50 at epoch 1039) and Tessera charges 20 bps, both verified live on mainnet on 24 Sept. A separate project had to drop support for both because escrow can't balance — the vault receives less than the program recorded.

The proposed product is a fee-aware escrow and settlement layer so protocols can actually hold and move these assets.

Two questions could kill it. Answer them first, before anything else.

Q1 — KILL QUESTION: is this a product or a fifty-line helper?

Token-2022 provides transfer_checked_with_fee and fee-calculation helpers in the spl-token-2022 crate. Anchor may already wrap them. So determine honestly: what does a protocol actually have to do to support a fee-bearing mint correctly, end to end — escrow in, hold, settle out, refund — and how much of that is already solved by existing tooling?

Enumerate every place the sent-versus-received gap causes a problem, not just the obvious transfer: accounting, pro-rata splits, refunds, rounding, and fee withholding. Report what the token program handles, what Anchor handles, what existing libraries handle, and what genuinely remains. Search for existing solutions and name them.

If the honest answer is "use the right instruction and it works", say so. That kills the idea and saves days.

Q2 — KILL QUESTION: does anything actually fail today?

Test live on mainnet rather than reasoning about it. For PreStocks and Tessera mints:

Does Jupiter quote and route them? Try several sizes and report the results.
Do Meteora, Raydium or Orca have pools holding them?
Do Kamino or other lending protocols accept them as collateral?

If major protocols already handle fee-bearing mints correctly, the "nobody can support these" premise is false and the product needs rethinking. Report what you find either way.

If Q1 and Q2 both survive, continue:

Q3 — Size the problem. How many mints on Solana have an active, non-zero transfer fee? Report the count with their volume and liquidity. Separate real assets from spam. If the entire affected market is a handful of low-volume mints, say so plainly.

Q4 — The fee mechanics in detail. Read the fee configs live: rate, maximum fee, and the older/newer epoch scheduling fields. Then answer: where are withheld fees held, who holds the withdraw authority, can the issuer change the rate and with what notice, and does a scheduled rate change mid-escrow break accounting that assumed the old rate? That last one is the interesting failure mode and it's the kind of thing only a live read reveals.

Q5 — Interactions with the other extensions. These mints also carry permanent delegate, pausable, scaled UI amount and metadata. Report how a fee interacts with a scaled-amount multiplier change, and whether raw-amount accounting stays correct across both.

Q6 — Bounty and track fit. PreStocks ($10,000) and Tessera ($6,000) both have Stocklana bounty tracks. Report what each bounty asks for, whether either publishes an API or docs, and whether this product would satisfy them. Note that Stocklana closes Friday 4pm ET, so the realistic target is Colosseum's Crypto World's Fair — report its deadline and requirements too.

Q7 — What the product would be. Given everything above, recommend one shape: a Rust crate other programs import, a standalone escrow program, an SDK, or a working venue that demonstrates it. Say which, with reasoning, and what the smallest demonstration that proves it would look like.

Q8 — Environment. Devnet availability of these mints (likely none — expect to build fixture mints with matching extensions), and estimated SOL cost.

Output: docs/phase0.md, with every claim sourced — mint address, RPC response, doc URL — inline. Where something couldn't be verified in the time available, say so explicitly rather than filling it in. Report and stop.