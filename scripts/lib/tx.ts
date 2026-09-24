// Send a transaction on local/devnet and return its confirmed record. Never used against mainnet:
// the RPC URL comes from env.rpcUrl(), which only knows local and devnet.
//
// Rate-limit safe: the SAME signed transaction is re-sent on 429/5xx (idempotent: one signature), and
// confirmation polls getSignatureStatuses with backoff until the blockhash expires.

import { Connection, Transaction, ComputeBudgetProgram, PublicKey } from "../../services/valuation/src/lib/web3.ts";
import type { Keypair, TransactionInstruction } from "../../services/valuation/src/lib/web3.ts";
import { rpcUrl, rpcFor, sleep } from "./env.ts";
import type { Cluster } from "./env.ts";
import { confirmTx } from "./cli.ts";
import type { TxRecord } from "./cli.ts";

export function connection(c: Cluster) {
  return new Connection(rpcUrl(c), { commitment: "confirmed", disableRetryOnRateLimit: false });
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(buf: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}

export async function send(c: Cluster, step: string, ixs: TransactionInstruction[], signers: Keypair[], cu = 400_000): Promise<TxRecord> {
  const rpc = rpcFor(c);
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  const bh = await rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }]);
  tx.recentBlockhash = bh.value.blockhash;
  tx.sign(...signers);
  const sig = bs58(tx.signature!);
  const wire = tx.serialize().toString("base64");
  // Preflight errors (program failures) are real: surface them with logs, don't retry.
  await rpc.call("sendTransaction", [wire, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }]).catch((e: any) => {
    const logs = e?.data?.logs ? `\n${e.data.logs.join("\n")}` : "";
    throw new Error(`${step}: ${e?.message ?? e}${logs}`);
  });
  for (let i = 0; ; i++) {
    const st = await rpc.call("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
    const s = st?.value?.[0];
    if (s?.err) throw new Error(`${step}: ${sig} failed ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) break;
    if (i % 5 === 4) {
      const h = await rpc.call("getBlockHeight", [{ commitment: "confirmed" }]).catch(() => 0);
      if (h > bh.value.lastValidBlockHeight) {
        // Last look before giving up: slow polling (rate limits) can outlast the blockhash of a tx that landed.
        await sleep(3000);
        const last = await rpc.call("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
        const ls = last?.value?.[0];
        if (ls?.err) throw new Error(`${step}: ${sig} failed ${JSON.stringify(ls.err)}`);
        if (ls) break;
        throw new Error(`${step}: ${sig} expired before confirmation (not found with history search)`);
      }
      await rpc.call("sendTransaction", [wire, { encoding: "base64", skipPreflight: true, maxRetries: 5 }]).catch(() => null); // same signature: idempotent
    }
    await sleep(2000);
  }
  return confirmTx(c, step, sig);
}

/** Simulate and return logs and error without sending (used to capture expected rejections). */
export async function simulate(c: Cluster, ixs: TransactionInstruction[], signers: Keypair[]) {
  const rpc = rpcFor(c);
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
  tx.sign(...signers);
  const r = await rpc.call("simulateTransaction", [tx.serialize().toString("base64"), { encoding: "base64", commitment: "confirmed" }]);
  return { err: r.value.err, logs: r.value.logs ?? [], slot: r.context.slot };
}

export async function tokenAmount(c: Cluster, account: string): Promise<bigint> {
  const r = await rpcFor(c).account(new PublicKey(account).toBase58());
  return BigInt(r.value.data.parsed.info.tokenAmount.amount);
}
