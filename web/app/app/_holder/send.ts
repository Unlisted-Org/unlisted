// Sending a flow's already-signed transactions, surviving the public RPC's transient failures.
//
// The wallet signs every transaction of a flow in one approval, so a retry must never need a new
// signature: it re-sends the SAME signed bytes. That is idempotent (same bytes, same signature;
// the network processes it at most once) and it is only done while the transaction's blockhash is
// still valid. A failure the program itself returns is never retried.
import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { confirmByPolling } from "@unlisted/sdk";

export interface SentTx { signature: string; slot: number | null; err: unknown }

/** Errors that say nothing about the transaction itself: a lagging or overloaded RPC node. */
export const TRANSIENT = /Blockhash not found|block height exceeded.*not|Node is behind|node is unhealthy|429|Too Many Requests|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timed? ?out|503|502|Service Unavailable/i;

export interface RetryOptions {
  attempts?: number; // total tries per transaction
  delayMs?: (attempt: number) => number;
  onRetry?: (i: number, attempt: number, reason: string) => void;
  /** The block height after which the flow's blockhash is dead (from getLatestBlockhash). When given,
   *  expiry is read from the chain's height, not guessed from the error text: a lagging node and an
   *  expired blockhash both say "Blockhash not found", and only the height tells them apart. */
  lastValidBlockHeight?: number;
  /** Status poll interval while confirming. 3 s suits the public RPC's quota; a dedicated RPC can go faster. */
  pollMs?: number;
}

type SendConn = Pick<Connection, "sendRawTransaction" | "isBlockhashValid" | "getSignatureStatuses"> & Partial<Pick<Connection, "getBlockHeight">>;

const expiredError = (i: number, why: string) =>
  new Error(`transaction ${i + 1} expired before it could land; nothing was charged. Sign again. (${why})`);

/** True when the chain is past the flow's last valid block height (so nothing signed with it can land). */
async function pastValidHeight(conn: SendConn, opts: RetryOptions): Promise<boolean> {
  if (opts.lastValidBlockHeight == null || !conn.getBlockHeight) return false;
  const h = await conn.getBlockHeight("confirmed").catch(() => 0);
  return h > opts.lastValidBlockHeight;
}

export async function sendOne(conn: SendConn, tx: VersionedTransaction, i: number, opts: RetryOptions = {}): Promise<string> {
  const attempts = opts.attempts ?? 6;
  const delay = opts.delayMs ?? ((a) => Math.min(8_000, 1_000 * 2 ** a));
  const raw = tx.serialize();
  let last: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
    } catch (e) {
      last = e;
      const msg = String((e as any)?.message ?? e) + "\n" + ((e as any)?.logs ?? []).join("\n");
      if (!TRANSIENT.test(msg)) throw e; // the program or the runtime rejected it: don't mask that
      // Still worth sending? A blockhash can only become invalid, never valid again.
      if (await pastValidHeight(conn, opts)) throw expiredError(i, msg.split("\n")[0]);
      const valid = await conn.isBlockhashValid(tx.message.recentBlockhash, { commitment: "processed" }).then((r) => r.value).catch(() => true);
      if (!valid && !/Blockhash not found/i.test(msg)) throw expiredError(i, msg.split("\n")[0]);
      opts.onRetry?.(i, a + 1, msg.split("\n")[0]);
      await new Promise((r) => setTimeout(r, delay(a)));
    }
  }
  throw last;
}

/** As the SDK's sendSequential (in order, each confirmed before the next, stop at the first failure),
 *  with transient-failure retries on each send. */
export async function sendSequentialWithRetry(conn: Connection, txs: VersionedTransaction[], onSent?: (i: number, sig: string) => void, opts: RetryOptions = {}): Promise<SentTx[]> {
  const out: SentTx[] = [];
  for (let i = 0; i < txs.length; i++) {
    const sig = await sendOne(conn, txs[i], i, opts);
    onSent?.(i, sig);
    const st = opts.pollMs != null || opts.lastValidBlockHeight != null
      ? await confirmFast(conn, sig, txs[i].serialize(), i, opts)
      : await confirmByPolling(conn, sig, txs[i].serialize());
    out.push({ signature: sig, slot: st.slot, err: st.err });
    if (st.err) break;
  }
  return out;
}

/** Confirm by polling, re-broadcasting the same bytes every ~2 s, and giving up as soon as the chain is
 *  past the blockhash's last valid height (it can no longer land), instead of waiting out a timeout. */
export async function confirmFast(conn: SendConn, sig: string, raw: Uint8Array, i: number, opts: RetryOptions): Promise<{ slot: number | null; err: unknown }> {
  const poll = opts.pollMs ?? 3_000;
  const start = Date.now();
  for (let n = 0; Date.now() - start < 120_000; n++) {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: n > 0 && n % 10 === 0 })).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" || st.err)) return { slot: st.slot, err: st.err };
    if (n > 0 && (n * poll) % 2_000 < poll) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    if (n > 0 && n % 3 === 0 && (await pastValidHeight(conn, opts))) {
      // One last look: it may have landed in the final valid block.
      const last = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (last) return { slot: last.slot, err: last.err };
      throw expiredError(i, "its blockhash expired while waiting to land");
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(`transaction ${sig} not confirmed within 120 s`);
}
