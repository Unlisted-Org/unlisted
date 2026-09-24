// Prop-AMM check on REAL mainnet state, nothing signed: simulateTransaction with sigVerify:false and
// replaceRecentBlockhash:true. For each prop AMM, a Jupiter /swap/v2/build route restricted to that AMM
// (plus Meteora DLMM for the second hop) is simulated with three takers:
//   wallet  — a system-owned wallet holding USDC (control: the route works at all);
//   pda     — an off-curve PDA of the basket program that does not exist on mainnet (system-owned, empty);
//   program — an existing program-owned data account (Symmetry vault NIT), standing in for the basket or a
//             deposit ticket, which are data accounts owned by the basket program.
// The pda and program takers are funded inside the same simulated transaction by a USDC transfer from the
// wallet (possible only because signatures are not verified). Output: fork/mainnet-prop-amm-sim.json.
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROGRAM_ID, ROOT, TOKEN, T22 } from "../src/env.ts";

const conn = new Connection(process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com", "confirmed");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WALLET = new PublicKey("H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS"); // USDC-holding wallet (phase 0)
const PROGRAM_OWNED = new PublicKey("G54nsrBx9a59YVqiqk2Sg3yX9wQauRz5MEugdWDjvmsf"); // Symmetry vault (owner BASKT7…)
const PDA = PublicKey.findProgramAddressSync([Buffer.from("basket"), Buffer.from("prop-amm-check")], PROGRAM_ID)[0];
const LEGS: Record<string, string> = {
  OPENAI: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", ANTHROPIC: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
  ANDURIL: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", KALSHI: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua",
};
// AMM -> (leg it was seen routing on the fork, dexes restriction)
const CASES: [string, string, string][] = [
  ["BisonFi", "OPENAI", "BisonFi,Meteora DLMM"],
  ["Flux", "OPENAI", "Flux,Meteora DLMM"],
  ["Quantum", "ANDURIL", "Quantum,Meteora DLMM"],
  ["Quantum", "OPENAI", "Quantum,Meteora DLMM"],
  ["Quantum", "KALSHI", "Quantum,Meteora DLMM"],
  ["TesseraV", "KALSHI", "TesseraV,Meteora DLMM"],
  ["Hadron", "ANTHROPIC", "Hadron"],
  ["1DEX", "OPENAI", "1DEX,Meteora DLMM"],
];
const out: any = { at: new Date().toISOString(), rpc: conn.rpcEndpoint, takers: { wallet: WALLET.toBase58(), pda: PDA.toBase58(), program: PROGRAM_OWNED.toBase58() }, results: [] as any[] };
let last = 0;
async function build(params: Record<string, string>) {
  const wait = last + 2_200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `https://api.jup.ag/swap/v2/build?${new URLSearchParams({ slippageBps: "300", maxAccounts: "30", ...params })}`;
  let res = await fetch(url);
  for (let k = 0; res.status === 429 && k < 8; k++) { await new Promise((r) => setTimeout(r, 5000 * (k + 1))); last = Date.now(); res = await fetch(url); }
  return { url, status: res.status, body: (await res.json()) as any };
}
const toIx = (j: any, payer?: PublicKey) => new TransactionInstruction({
  programId: new PublicKey(j.programId), data: Buffer.from(j.data, "base64"),
  keys: j.accounts.map((a: any, i: number) => ({ pubkey: payer && i === 0 ? payer : new PublicKey(a.pubkey), isSigner: payer && i === 0 ? true : a.isSigner, isWritable: a.isWritable })),
});

async function main() {
  const ownerInfo = await conn.getAccountInfo(PROGRAM_OWNED);
  out.programOwnedTaker = { owner: ownerInfo?.owner.toBase58(), dataLen: ownerInfo?.data.length, onCurve: PublicKey.isOnCurve(PROGRAM_OWNED.toBytes()) };
  out.pdaTaker = { exists: !!(await conn.getAccountInfo(PDA)), onCurve: PublicKey.isOnCurve(PDA.toBytes()) };
  const walletUsdc = spl.getAssociatedTokenAddressSync(USDC, WALLET);
  for (const [amm, leg, dexes] of CASES) {
    for (const [kind, taker] of [["wallet", WALLET], ["pda", PDA], ["program", PROGRAM_OWNED]] as const) {
      const { url, status, body } = await build({ inputMint: USDC.toBase58(), outputMint: LEGS[leg], amount: "10000000", taker: taker.toBase58(), dexes });
      const rec: any = { amm, leg, taker: kind, url, status, route: body.routePlan?.map((p: any) => p.swapInfo.label), outAmount: body.outAmount, error: body.error };
      if (status === 200 && body.swapInstruction) {
        const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })];
        if (kind !== "wallet") {
          const ata = spl.getAssociatedTokenAddressSync(USDC, taker, true);
          ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(WALLET, ata, taker, USDC));
          ixs.push(spl.createTransferInstruction(walletUsdc, ata, WALLET, 10_000_000n));
        }
        for (const s of body.setupInstructions ?? []) ixs.push(toIx(s, s.programId === spl.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() ? WALLET : undefined));
        ixs.push(toIx(body.swapInstruction));
        const alts: AddressLookupTableAccount[] = [];
        for (const k of Object.keys(body.addressesByLookupTableAddress ?? {})) { const a = await conn.getAddressLookupTable(new PublicKey(k)); if (a.value) alts.push(a.value); }
        const msg = new TransactionMessage({ payerKey: WALLET, recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message(alts);
        const sim = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
        const logs = sim.value.logs ?? [];
        rec.simSlot = sim.context.slot;
        rec.ok = !sim.value.err;
        rec.err = sim.value.err;
        rec.cu = sim.value.unitsConsumed;
        rec.keyLogs = logs.filter((l) => /Error|failed|Owner|owner|constraint|invoke \[2\]/.test(l)).slice(0, 12);
      }
      out.results.push(rec);
      console.log(`${amm.padEnd(9)} ${leg.padEnd(10)} ${kind.padEnd(8)} route=${(rec.route ?? []).join("→")} ${rec.ok === undefined ? `build ${status} ${rec.error ?? ""}` : rec.ok ? "OK" : "FAIL " + JSON.stringify(rec.err)} ${rec.keyLogs?.find((l: string) => /Error|failed/.test(l)) ?? ""}`);
      fs.writeFileSync(path.join(ROOT, "tests/program/fork/mainnet-prop-amm-sim.json"), JSON.stringify(out, null, 1));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
