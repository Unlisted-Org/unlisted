// Send a transaction on local/devnet and return its confirmed record. Never used against mainnet:
// the Connection URL comes from env.rpcUrl(), which only knows local and devnet.

import { Connection, Transaction, ComputeBudgetProgram, PublicKey } from "../../services/valuation/src/lib/web3.ts";
import type { Keypair, TransactionInstruction } from "../../services/valuation/src/lib/web3.ts";
import { rpcUrl } from "./env.ts";
import type { Cluster } from "./env.ts";
import { confirmTx } from "./cli.ts";
import type { TxRecord } from "./cli.ts";

export function connection(c: Cluster) {
  return new Connection(rpcUrl(c), "confirmed");
}

export async function send(c: Cluster, step: string, ixs: TransactionInstruction[], signers: Keypair[], cu = 400_000): Promise<TxRecord> {
  const conn = connection(c);
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return confirmTx(c, step, sig);
}

/** Simulate and return logs and error without sending (used to capture expected rejections). */
export async function simulate(c: Cluster, ixs: TransactionInstruction[], signers: Keypair[]) {
  const conn = connection(c);
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const r = await conn.simulateTransaction(tx);
  return { err: r.value.err, logs: r.value.logs ?? [], slot: r.context.slot };
}

export async function tokenAmount(c: Cluster, account: string): Promise<bigint> {
  const conn = connection(c);
  const r = await conn.getTokenAccountBalance(new PublicKey(account), "confirmed");
  return BigInt(r.value.amount);
}
