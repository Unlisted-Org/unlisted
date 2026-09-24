# Evidence: Symmetry under a pause and a seizure

**What this shows.** Symmetry is a live, permissionless basket protocol on Solana. It handles the Token-2022 transfer fee correctly (proven on mainnet below). But:

1. **One paused constituent blocks the whole withdrawal after the shares are burned.** The user receives none of the basket's other tokens until the issuer unpauses.
2. **A permanent-delegate seizure breaks every redemption**, because Symmetry accounts from its own records instead of the vault's actual balances.

Our basket is built around these two failures (see `docs/specs/01-shares-and-pricing.md`).

## How it was produced

- **Symmetry's real deployed program** (`BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`) ran on a **local Surfpool fork of mainnet**.
- It was driven with Symmetry's own SDK (`@symmetry-hq/sdk` 1.0.22) against the live vault **NIT** (`G54nsrBx9a59YVqiqk2Sg3yX9wQauRz5MEugdWDjvmsf`).
- NIT holds xStocks. They carry the same `pausable` and `permanentDelegate` Token-2022 extensions as PreStocks.
- Each scenario starts from a **fresh fork** with a **fresh wallet** that is given 100,000 NIT shares and redeems 50,000 in kind (all tokens kept, Symmetry's fast path).
- The pause and the seizure are applied **only on the fork**, by editing account state: the pause flag on the NVDAx mint, and the vault's AAPLx balance.
- **Nothing was sent to mainnet.** The signatures below exist only on the local fork and can't be looked up on an explorer. Re-run with `./run.sh` to reproduce them.

Raw transcripts: `out/baseline.json`, `out/pause.json`, `out/seize.json`.

## 1. Baseline: withdrawal works

| Step | Result |
|---|---|
| `sellVaultTx` | ok: `5oDTkvJtfRtouFeFYX19js4cLcWX1meH4x5AoVd3ftxU98rDipaCTMXyuCsJqR9mv2CiJqGDY4uc8CbAEAHdxf5o` |
| `redeemTokensTx` | ok: `2nRs8FyQUKiqRorpx7GGEXhr69Qzws8fNopofBCCKYEvk8pATTtjKkPgqKCwT9TBj5nP3miNRjEq6tjyo7CyCh4c` |
| Received (raw, net of wallet's pre-redeem balances) | wSOL 165692, AMZNx 2464, GOOGLx 2421, AAPLx 1855, NVDAx 5213, MSFTx 1172 |

## 2. Pause one constituent mid-redemption: the whole withdrawal is blocked

| Step | Result |
|---|---|
| `sellVaultTx` (burns 50,000 shares) | ok: `36my68u1y4RUM99zC8NU48H1nNvZwoayetyvwLTNEetwMeXmk1sFVeeREpPVV1Mbsd49KnusfUiaCdqwb39ndmkf`. Wallet shares after: 50000 |
| Pause **NVDAx** (`Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`) | `paused: true` |
| `redeemTokensTx` | **FAILED**: `Program log: Transferring, minting, and burning is paused on this mint / Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x43` |
| retry while paused | **FAILED**, same error |
| Received while paused, net of pre-redeem balances | **nothing**: none of the 6 constituents the baseline redemption pays (wSOL, AMZNx, GOOGLx, AAPLx, NVDAx, MSFTx) |
| Resume NVDAx, then `redeemTokensTx` | ok: `5vwazo7biYuxgZo9UHzR14UtahZAwTaArnduvHdGi5kpKJAWMwZZzrdrpUtvvnr28RKhaoahZ4BEKUZwG6Z7cH6H` |
| Received after resume | wSOL 165692, AMZNx 2464, GOOGLx 2421, AAPLx 1855, NVDAx 5213, MSFTx 1172 |

The user's shares were burned at `sellVaultTx`. While a single constituent was paused, the user held **neither shares nor any of the other constituents**. The error comes from Token-2022 inside Symmetry's `redeemTokensTx`, and Symmetry has no path that pays the unaffected constituents.

## 3. Seize one constituent from the vault: every redemption fails

| | AAPLx recorded by Symmetry | AAPLx actually in vault |
|---|---|---|
| Before | 27183 | 27183 |
| After seizure (balance set to 0, as a permanent-delegate burn would) | 27183 | 0 |
| After `sellVaultTx` | 25328 | 0 |

| Step | Result |
|---|---|
| `sellVaultTx` (burns 50,000 shares) | ok: `48D3rEpDeBx2Uqkp1DPAqFJE9PsW5KUrznwJV6u1T1iUUGgPTKQ8VLNqj9gqM6Du8QbCpwgDFRywrEwsQ2ys6NsH` |
| `redeemTokensTx` | **FAILED**: `Program log: Error: insufficient funds / Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x1` |
| Received | **nothing** |

Symmetry kept recording AAPLx that no longer existed and kept accepting sells against it. Each redemption then tries to pay its recorded share of AAPLx, fails, and pays **none** of the constituents, including the 5 that weren't seized. Any redeemer after the seizure is stuck.

## 4. Live mainnet: Symmetry doesn't reconcile to balances (read at slot 450108480)

`node mainnet-recon.js` reads every Symmetry vault (`39` vaults) and compares each Token-2022 holding's recorded amount with its actual balance:

| Vault | Token | Fee | Recorded | Actual | Actual − recorded |
|---|---|---|---|---|---|
| STACCINDEX | Staccana | 0 bps | 465500693 | 143744608698 | 143279108005 |
| STACCINDEX | PROOFV3 | 0 bps | 1297929501 | 3499776501 | 2201847000 |
| STACCINDEX | FOMOX402 | 0 bps | 954353172052 | 1355946457810 | 401593285758 |
| STKPILOT | LOOM | 300 bps | 14038511219349 | 14038511219349 | 0 |
| RCHA | STRCx | 0 bps | 616 | 616 | 0 |
| BFI | COINx | 0 bps | 1331275 | 1331275 | 0 |
| NIT | AMZNx | 0 bps | 36099 | 36099 | 0 |
| NIT | GOOGLx | 0 bps | 35467 | 35467 | 0 |
| NIT | AAPLx | 0 bps | 27183 | 27183 | 0 |
| NIT | NVDAx | 0 bps | 76366 | 76366 | 0 |
| NIT | MSFTx | 0 bps | 17177 | 17177 | 0 |
| BADPO | SPYx | 0 bps | 1393424 | 1393424 | 0 |
| MX10 | PUMP | 0 bps | 340535665 | 340535665 | 0 |

- **STACCINDEX:** actual balances run far above recorded, and Symmetry ignores the surplus. That is the same record-over-balance design that makes a seizure invisible.
- **STKPILOT / LOOM** is the concession: a 300 bps transfer-fee mint recorded **exactly** equal to its balance.
  - Its full history is four mainnet transactions:
    1. `4SDJKtrC8HbE7MoR3B9XhS57sJPufpmDCQi3QmS2BxH1vQzN5YNqrSUZ1JKLhjcny5GEHBgjsQTGczBG5KHuEtTo`: vault account created.
    2. `D89FULZ2mmCJGiRR8g4yPhnzfsvM1m7BQE5vptXTSFDsPQYqYbr81qE2GzBi2a3iU1C5DXze35m24kC7HLU6zpB`: 14,533,669,008,755 in gross, with a fee of ceil(3%) = 436,010,070,263.
    3. `5uPzBDeJi8kGYCChRZe9zwVKUfJ521vwjrPLBjhMxPcWvsAaC8hq7TuFqUuD2gegjT7RMxipJ5b4uuWQWJzcVy1y`: the issuer withdraws the withheld fee.
    4. `DcC3dTqmbojg9v5NNHk1Yk5ufbN16MK5pTuzvmZb59sJeobTQAvnoqqCKASbpYaMXkVZvTXxty1FLn7W9TzN1eC`: 59,147,719,143 out.
  - 14,533,669,008,755 − 436,010,070,263 − 59,147,719,143 = **14,038,511,219,349**, which equals both the recorded and the actual amount. **Symmetry handles the transfer fee correctly, and we say so.**

## Reproduce

```sh
cd evidence/symmetry-fork
./run.sh              # three fresh forks: baseline, pause, seize -> out/*.json
node mainnet-recon.js # live mainnet read -> out/mainnet-recon.json
```

Requires `surfpool` (tested with 0.12.0) and Node ≥ 20. Uses the public mainnet RPC as the fork's data source; set `DATASOURCE` or `MAINNET_RPC` to use another.
