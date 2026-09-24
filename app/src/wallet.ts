// Wallet Standard, no adapter library. A flow's transactions go to the wallet in ONE
// solana:signTransaction call with several inputs: one approval for the whole flow.
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export const SIGN_TX = "solana:signTransaction";
export const CONNECT = "standard:connect";
export const DISCONNECT = "standard:disconnect";

export function usableWallets(): Wallet[] {
  return getWallets().get().filter((w) => CONNECT in w.features && SIGN_TX in w.features);
}

export function onWalletsChanged(cb: () => void): () => void {
  const api = getWallets();
  const a = api.on("register", cb);
  const b = api.on("unregister", cb);
  return () => { a(); b(); };
}

export interface Connected {
  wallet: Wallet;
  account: WalletAccount;
  publicKey: PublicKey;
  chain: `${string}:${string}`;
}

export async function connect(wallet: Wallet, cluster: "devnet" | "localnet"): Promise<Connected> {
  const res = await (wallet.features[CONNECT] as any).connect();
  const account: WalletAccount | undefined = res.accounts[0] ?? wallet.accounts[0];
  if (!account) throw new Error("wallet returned no account");
  return { wallet, account, publicKey: new PublicKey(account.address), chain: `solana:${cluster}` };
}

/** One approval for every transaction of a flow. Returns the signed transactions in order. */
export async function signAll(c: Connected, txs: VersionedTransaction[]): Promise<VersionedTransaction[]> {
  const feature = c.wallet.features[SIGN_TX] as any;
  const outputs = await feature.signTransaction(...txs.map((t) => ({ account: c.account, chain: c.chain, transaction: t.serialize() })));
  return outputs.map((o: { signedTransaction: Uint8Array }) => VersionedTransaction.deserialize(o.signedTransaction));
}
