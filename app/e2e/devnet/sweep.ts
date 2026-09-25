// Return leftover SOL from saved test wallets (e2e/.local/wallets) to the app key. Devnet only.
import { readdirSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { conn, loadEnv, loadKey, sendAndConfirmTransaction } from "../harness";

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = join(HERE, "../.local/wallets");
const env = loadEnv();
if (env.cluster !== "devnet") throw new Error("E2E_ENV=devnet only");
const c = conn(env);
const to = loadKey(env.funderKey!).publicKey;
mkdirSync(join(dir, "swept"), { recursive: true });
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const w = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(dir, f), "utf8"))));
  const bal = await c.getBalance(w.publicKey);
  if (bal > 10_000) {
    const s = await sendAndConfirmTransaction(c, new Transaction().add(SystemProgram.transfer({ fromPubkey: w.publicKey, toPubkey: to, lamports: bal - 5_000 })), [w]);
    console.log(`${w.publicKey.toBase58()}: returned ${(bal - 5_000) / 1e9} SOL (${s})`);
  }
  renameSync(join(dir, f), join(dir, "swept", f));
}
