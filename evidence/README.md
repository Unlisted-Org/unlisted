# Evidence

The strongest material this project has. Each item is reproducible, and every number comes from a live read, a confirmed transaction, or a recorded fork run. These are the sources for the pitch video and the demo.

## 1. Symmetry under issuer action (the pitch)

**[`symmetry-fork/`](symmetry-fork/README.md).** Symmetry's real program on a local mainnet fork, driven by its own SDK against a live vault:

- **Pause one constituent mid-redemption.** The shares are already burned and the redemption reverts with `MintPaused`. The user receives **none** of the other constituents until the issuer unpauses.
- **Seize one constituent from the vault.** Symmetry still records the seized tokens, accepts the sell, then every redemption reverts with `insufficient funds` and pays **nothing**.
- **Live mainnet** (`mainnet-recon.js`, slot 450108480). Symmetry vault STACCINDEX records amounts that differ from its actual balances by up to 143,279,108,005 raw units. Symmetry keeps its own records and doesn't reconcile them to the chain.
- **The concession, also proven on mainnet.** Symmetry handles the transfer fee correctly: a 300 bps fee mint reconciles to the unit across its full four-transaction history.

The fork signatures exist only on the local fork. `./run.sh` reproduces them from fresh forks in a few minutes.

## 2. Issuer controls on a PDA vault: real, confirmed devnet transactions

Fixture mint `5vcYoRJcfzk8Xv5spWusaxLBJcp6p99GSvk7f4x2wi4t` has the same Token-2022 extension set as mainnet PreStocks; the extension diff is empty in both directions. It was used against vault `B2KcUV5LqZnVQ5krqzcS6K6RBM6SeapGVJrjdFtiAFqB`, owned by a program PDA. Every transaction below was re-checked `finalized` with no error.

| What | Signature (devnet) |
|---|---|
| Fixture mint created with the PreStocks extension set | [`4h7rrgve…KgSh`](https://explorer.solana.com/tx/4h7rrgveoefeQad15RruXNw8cmQYBpTzb1yApMWr7tkjeDMNGs9RePzMftyzwTaR426afGkAqD7UHZc8FTbcKgSh?cluster=devnet) |
| Metadata initialised | [`ZrTbsGyS…hDhh`](https://explorer.solana.com/tx/ZrTbsGySstLVa7cKQuMbQP394xNuohj7koWFbhSKfz9C1XRTJGdNdzs5FjQeUKQqCWCsdhnpQpnXdSqaetGBDhh?cluster=devnet) |
| 10 tokens sent to the PDA vault; 9.9 received, 0.1 withheld (1% fee) | [`3R35LKHG…ZK9v`](https://explorer.solana.com/tx/3R35LKHGDRGVKHPNTiKGCfQQhceEonwSmGnY8QB5cCaWd1mzA118iAdEXE45tb1Uz2jsUaFdKybjMMJh6Gt7ZK9v?cluster=devnet) |
| **Permanent delegate burns 2.5 from the PDA vault without the vault signing** (9.9 → 7.4) | [`2ouUBzUZ…63`](https://explorer.solana.com/tx/2ouUBzUZniEC3BYJzBbFQXRvjR4o3HF23FVioDutXfKd8XQScHHNLDBTaCWgNWEzE7w5SpS4t3zPimCQTfRiCG63?cluster=devnet) |
| **Mint paused**; the following transfer was rejected with `MintPaused` (0x43) | [`2ttKtuiU…3fbzcf`](https://explorer.solana.com/tx/2ttKtuiUFcPSV42D7XcsdHXz4H7TXMqyypwesmdAvu7zvzXz5Wbv4ac38ZkN3RHxbr9XmweA9Gvu5fZF7d3fbzcf?cluster=devnet) |

Rejected transactions never land, so they have no signature. The `MintPaused` (0x43) and `AccountFrozen` (0x11) rejections were recorded from the RPC preflight response (`docs/phase0.md`, Q4).

**None of these can be run on mainnet**, because the keys belong to the issuer (a 2-of-7 Squads multisig). The fixture suite in spec 02 turns each into a signed, repeatable scenario against our own program.

## 3. Share maths: executable spec

[`spec/model/`](../spec/model/): the reference model and 17 property tests covering rounding, shortfall, partial redemption and the IPO rule.

```sh
python3 -m unittest discover -s spec/model -v
```

Three deliberate mutations each make the suite fail:
- rounding redemption up;
- letting an open ticket escape a seizure;
- paying a paused leg instead of creating a claim.

## 4. Jupiter / Manifest over-quote (reported upstream, not a product)

Manifest's Jupiter adapter quotes PreStocks output gross of the 1% transfer fee. As a result, swaps at ≤ 50 bps slippage revert, and Jupiter's router prefers Manifest even when other venues deliver more.

- Root cause and reproduction: [Bonasa-Tech/manifest#735](https://github.com/Bonasa-Tech/manifest/issues/735).
- Router impact: [jup-ag/jupiter-swap-api-client#65](https://github.com/jup-ag/jupiter-swap-api-client/issues/65).
- Reproduced at mainnet slots 450095131–450095187 by simulation.
