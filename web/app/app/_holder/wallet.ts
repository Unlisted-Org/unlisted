// Signing through the Solana wallet adapter. A flow's transactions go to the wallet in ONE request:
// one approval for the whole flow. For a Wallet Standard wallet the request names the cluster's chain
// explicitly (the adapter's own signAllTransactions leaves it out); anything else falls back to the
// adapter's signAllTransactions, which is still one approval.
import type { Adapter } from "@solana/wallet-adapter-base";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export const SIGN_TX = "solana:signTransaction";

export async function signAll(adapter: Adapter, owner: PublicKey, cluster: "devnet" | "localnet", txs: VersionedTransaction[]): Promise<VersionedTransaction[]> {
  const std = (adapter as any).standard === true ? (adapter as any).wallet : null;
  const feature = std?.features?.[SIGN_TX];
  const account = std?.accounts?.find((a: any) => a.address === owner.toBase58());
  if (feature && account) {
    const outputs = await feature.signTransaction(...txs.map((t) => ({ account, chain: `solana:${cluster}`, transaction: t.serialize() })));
    return outputs.map((o: { signedTransaction: Uint8Array }) => VersionedTransaction.deserialize(o.signedTransaction));
  }
  const a = adapter as any;
  if (typeof a.signAllTransactions !== "function") throw new Error(`${adapter.name} can't sign transactions`);
  return a.signAllTransactions(txs);
}
