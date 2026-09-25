# Brief: Agent A, `fee-change-after` (devnet, epoch ≥ 1167)

You are Agent A, starting fresh. This brief is everything you need; don't reconstruct earlier sessions. Do exactly one job, report, and stop.

## The job

Run the second half of the `fee-change-mid-position` devnet scenario, once devnet is in epoch 1167 or later.

**Background.** The first half ran on 2026-09-24 (the record's steps 0–8):
- the fixture issuer scheduled the transfer fee 100 → 300 bps on basket `B1VnJMbgGZwDDuNkHAiyGmj8oc4gmzUHN6DYtHhonFhK`'s seven fixture mints, effective at epoch 1167;
- a redemption before that epoch paid under 100 bps.

This run shows that a redemption after epoch 1167 pays under 300 bps, with the program storing no fee.

## Where

- **Worktree:** `/Users/jagadeesh/1nonly/grants/stocklana-worktrees/program`, branch `program`. You own only `programs/basket/` and `tests/program/`.
- **Script:** `tests/program/devnet/scenarios.ts`, scenario `fee-change-after`.
- **Record:** the run appends to `tests/program/devnet/fee-change-mid-position.json`, adding a `BROKEN` simulated step, the real redemption step, its checks, and an `afterFeeEffective` block. Don't create a separate file.

## Key

`~/.config/solana/stocklana/program.json` (pubkey `DBJ6FdxbtWEZsVjUsZ3PBMefpxvmtQX8pMp7sDULoFgb`). It is the payer, the basket authority and the fixture issuer. It held 2.733 devnet SOL on 2026-09-25, and this run needs well under 0.01. Alice's key is derived by the script (`DEVNET_SEED` default `devnet-v1`); don't set `DEVNET_SEED`.

Never use `~/.config/solana/id.json` or anything under `~/.config/solana/uncross/`. Never sign on mainnet.

## Steps

1. **Check the epoch once** (the script also refuses below 1167):
   ```sh
   curl -s https://api.devnet.solana.com -X POST -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getEpochInfo"}'
   ```
   If `epoch` is below 1167, stop and report that. **Don't wait or poll.**
2. **Run it:**
   ```sh
   cd /Users/jagadeesh/1nonly/grants/stocklana-worktrees/program/tests/program
   node --import tsx devnet/scenarios.ts fee-change-after 2>&1 | tee devnet/console-fee-after.txt
   ```
   The public devnet RPC rate-limits; the script throttles and retries by itself. Let it finish.
3. **What must hold,** all recorded as checks in the record:
   - The mint's current fee at this epoch is 300 bps.
   - **Broken version first.** A simulated redemption (signed, not sent) proves two things before anything is sent:
     - a fee model frozen at 100 bps is wrong on every leg;
     - 300 bps holds on every leg.
   - The real redemption lands, and on every leg the net received = gross − ceil(gross·300/10⁴), which differs from the 100 bps figure.
   - `passed: true` in the record.
4. **Verify on chain.** Confirm the new redemption signature is `finalized` with `err: null` (`getSignatureStatuses` with `searchTransactionHistory: true`). Then run `node --import tsx devnet/verify.ts` if it covers this file, and note its result.
5. **Commit** the record and `devnet/console-fee-after.txt` on `program`.
   - Identity is already set in the repo config (1nonlypiece); don't change it.
   - The message must not contain an AI attribution line. The `commit-msg` hook refuses one, and matches the words anywhere in the message, so don't write them at all.
   - Never use `--no-verify`. Rules: `CONTRIBUTING.md` on `main`.
   - **Don't push.** The spec owner pushes and merges.
6. **Report and stop.** Report:
   - the epoch;
   - the redemption signature and slot;
   - per leg: gross, received, and the 300 bps and 100 bps figures;
   - the broken-version result;
   - the commit hash;
   - SOL spent.

   Then end the session. Don't start anything else, and leave nothing running.

## If it fails

Don't retry in a loop, and don't change the program. If the script throws, a check fails, or the RPC refuses repeatedly, commit nothing. Report:
- the exact error;
- the last 30 lines of `console-fee-after.txt`;
- whether a redemption landed (search the record for a new signature).

Then stop.

## Already verified before this session

- **Commit:** `fee-change-after`, including the broken-version step, is committed on `program` (see `git log -3`).
- **Rehearsal:** it ran against a fresh local validator with both halves of the scenario, so the code runs as written.
- **`setup()`:** it reuses `tests/program/devnet/setup.json` and re-creates nothing.
