// A TEST wallet implementing Wallet Standard, injected into the page by Playwright. It is not
// Phantom or any production wallet: it holds a keypair generated fresh for each e2e run and
// approves every request automatically, recording each approval (one call = one approval) and
// how many transactions it covered, so the test can assert "one approval per flow".
import { registerWallet } from "@wallet-standard/wallet";
import { ReadonlyWalletAccount } from "@wallet-standard/wallet";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

declare global {
  interface Window {
    __STOCKLANA_TEST_WALLET_SECRET__?: number[];
    __testWallet?: { address: string; approvals: { at: string; transactions: number; chain: string }[] };
  }
}

const ICON = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#a3261b"/><text x="16" y="21" font-size="12" text-anchor="middle" fill="#fff" font-family="monospace">TEST</text></svg>');
const CHAINS = ["solana:devnet", "solana:localnet"] as const;

function install() {
  const secret = window.__STOCKLANA_TEST_WALLET_SECRET__;
  if (!secret) return;
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  const account: WalletAccount = new ReadonlyWalletAccount({
    address: kp.publicKey.toBase58(), publicKey: kp.publicKey.toBytes(), chains: CHAINS, features: ["solana:signTransaction"],
  });
  const state = { address: kp.publicKey.toBase58(), approvals: [] as { at: string; transactions: number; chain: string }[] };
  window.__testWallet = state;

  const wallet: Wallet = {
    version: "1.0.0",
    name: "Stocklana Test Wallet",
    icon: ICON as `data:image/svg+xml;base64,${string}`,
    chains: CHAINS,
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { account: WalletAccount; chain?: string; transaction: Uint8Array }[]) => {
          for (const i of inputs) if (i.chain && !CHAINS.includes(i.chain as any)) throw new Error(`test wallet refuses chain ${i.chain}`);
          state.approvals.push({ at: new Date().toISOString(), transactions: inputs.length, chain: inputs[0]?.chain ?? "" });
          return inputs.map((i) => {
            const tx = VersionedTransaction.deserialize(i.transaction);
            tx.sign([kp]);
            return { signedTransaction: tx.serialize() };
          });
        },
      },
    } as any,
  };
  registerWallet(wallet);
}

install();
