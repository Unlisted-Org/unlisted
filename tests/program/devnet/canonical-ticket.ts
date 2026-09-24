// One USDC deposit ticket on the canonical devnet basket through C's fixture_amm (the devnet router):
// open_deposit_ticket → ticket_swap_leg ×7 (output straight into each vault, measured) → finalize_deposit.
// Usage: node --import tsx devnet/canonical-ticket.ts <registry.json>   Appends to tests/program/devnet/canonical.json.
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { ix } from "../src/basket.ts";
import { PROGRAM_ID, ROOT, T22, TOKEN, coder, parseEvents, u64le } from "../src/env.ts";

let lastCall = 0;
async function politeFetch(input: any, init?: any): Promise<Response> {
  for (let k = 0; ; k++) {
    const wait = lastCall + 150 - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    lastCall = Date.now();
    try { const res = await fetch(input, init); if (res.status !== 429 || k >= 30) return res; } catch (e) { if (k >= 30) throw e; }
    await new Promise((ok) => setTimeout(ok, Math.min(30_000, 1_000 * 2 ** Math.min(k, 5))));
  }
}
const conn = new Connection(process.env.DEVNET_RPC ?? "https://api.devnet.solana.com", { commitment: "confirmed", fetch: politeFetch as any, disableRetryOnRateLimit: true });
const OUT = path.join(ROOT, "tests/program/devnet/canonical.json");
const rec = JSON.parse(fs.readFileSync(OUT, "utf8"));
const reg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME!, ".config/solana/stocklana/program.json"), "utf8"))));
const bn = (x: bigint | number) => new BN(x.toString());
const basket = new PublicKey(rec.basket), shareMint = new PublicKey(rec.shareMint), USDC = new PublicKey(rec.usdcMint);
const AMM = new PublicKey(reg.fixture_amm.program_id);
const MINTS = rec.legs.map((l: any) => new PublicKey(l.mint));
const VAULTS = rec.legs.map((l: any) => new PublicKey(l.vault));
const USDC_PER_LEG = BigInt(process.env.USDC_PER_LEG ?? 1_000_000); // $1 per leg
const T: any = { steps: [] as any[] };
rec.ticketDeposit = T;
const save = () => fs.writeFileSync(OUT, JSON.stringify(rec, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

async function send(label: string, ixs: TransactionInstruction[], alts: AddressLookupTableAccount[]) {
  let prev: string | undefined;
  for (let attempt = 0; ; attempt++) {
    if (prev) {
      const st = (await conn.getSignatureStatuses([prev], { searchTransactionHistory: true })).value[0];
      if (st && !st.err && st.confirmationStatus) return done(label, prev, 0);
    }
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...ixs] }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg);
    tx.sign([owner]);
    const size = tx.serialize().length;
    const accounts = msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
    try {
      prev = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 });
      for (;;) {
        const st = (await conn.getSignatureStatuses([prev])).value[0];
        if (st?.err) throw Object.assign(new Error(`${label}: ${JSON.stringify(st.err)}`), { landed: true });
        if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return done(label, prev, size, accounts);
        if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("block height exceeded");
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } catch (e: any) {
      if (!e.landed && attempt < 5 && /blockhash|429|block height exceeded|fetch failed/i.test(String(e.message))) continue;
      T.steps.push({ label, ok: false, error: String(e.message).slice(0, 600), logs: e.logs });
      save();
      throw e;
    }
  }
}
async function done(label: string, sig: string, size: number, accounts?: number) {
  const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const logs = t?.meta?.logMessages ?? [];
  T.steps.push({ label, signature: sig, slot: t?.slot, size, accounts, cu: t?.meta?.computeUnitsConsumed,
    cpiDepth: Math.max(0, ...logs.map((l) => Number(l.match(/invoke \[(\d+)\]/)?.[1] ?? 0))), events: parseEvents(logs).map((e) => ({ name: e.name, data: e.data })) });
  save();
  console.log(`${label}: ${sig}`);
  return sig;
}
const amount = async (a: PublicKey) => BigInt((await conn.getTokenAccountBalance(a)).value.amount);

async function main() {
  const alt = (await conn.getAddressLookupTable(new PublicKey(rec.lookupTable))).value!;
  const nonce = Number(process.env.TICKET_NONCE ?? 0);
  const ticket = PublicKey.findProgramAddressSync([Buffer.from("deposit"), basket.toBuffer(), owner.publicKey.toBuffer(), u64le(nonce)], PROGRAM_ID)[0];
  const escrow = spl.getAssociatedTokenAddressSync(USDC, ticket, true, TOKEN);
  const ownerUsdc = spl.getAssociatedTokenAddressSync(USDC, owner.publicKey, false, TOKEN);
  const ownerShare = spl.getAssociatedTokenAddressSync(shareMint, owner.publicKey, false, TOKEN);
  Object.assign(T, { ticket: ticket.toBase58(), escrow: escrow.toBase58(), usdcPerLeg: USDC_PER_LEG, router: AMM.toBase58() });
  await send("open_deposit_ticket (7 × $1 fixture USDC)", [ix("open_deposit_ticket", { owner: owner.publicKey, basket, ticket, escrow, owner_usdc: ownerUsdc, usdc_mint: USDC },
    { nonce: bn(nonce), usdc_in: bn(USDC_PER_LEG * 7n), expiry_slots: bn(1500) }, MINTS.flatMap((m: PublicKey, i: number) => [r(m), r(VAULTS[i])]))], [alt]);
  const legs: any[] = [];
  const swapIxs: TransactionInstruction[] = [];
  for (let i = 0; i < 7; i++) {
    const p = reg.fixture_amm.pools.find((x: any) => x.leg_mint === MINTS[i].toBase58());
    const [legRes, usdcRes] = [await amount(new PublicKey(p.leg_vault)), await amount(new PublicKey(p.usdc_vault))];
    const inAfterFee = (USDC_PER_LEG * BigInt(10_000 - reg.fixture_amm.lp_fee_bps)) / 10_000n;
    const poolOut = (legRes * inAfterFee) / (usdcRes + inAfterFee);
    const expectNet = poolOut - (poolOut * 100n + 9_999n) / 10_000n; // 1 % Token-2022 fee on the way into the vault
    const minOut = (expectNet * 98n) / 100n;
    const data = Buffer.concat([Buffer.from([1]), u64le(USDC_PER_LEG), u64le(0n), Buffer.from([0])]); // buy; the basket checks the measured delta
    const route = [w(new PublicKey(p.pool)), r(MINTS[i]), r(USDC), w(new PublicKey(p.leg_vault)), w(new PublicKey(p.usdc_vault)), r(ticket), w(escrow), w(VAULTS[i]), r(T22), r(TOKEN)];
    swapIxs.push(ix("ticket_swap_leg", { owner: owner.publicKey, basket, ticket, escrow, leg_mint: MINTS[i], leg_vault: VAULTS[i], router_program: AMM },
      { leg: i, usdc_amount: bn(USDC_PER_LEG), min_out: bn(minOut), route_data: data }, route));
    legs.push({ leg: rec.legs[i].symbol, pool: p.pool, expectedNet: expectNet, minOut });
  }
  // Pack as many legs per transaction as fit.
  const v0 = await Promise.all(VAULTS.map(amount));
  const fits = (g: TransactionInstruction[]) => {
    try {
      const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...g] }).compileToV0Message([alt]);
      const keys = msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
      return keys <= 64 && new VersionedTransaction(msg).serialize().length <= 1232;
    } catch { return false; }
  };
  let cur: number[] = [];
  const groups: number[][] = [];
  for (let i = 0; i < 7; i++) { if (fits([...cur, i].map((k) => swapIxs[k]))) cur.push(i); else { groups.push(cur); cur = [i]; } }
  if (cur.length) groups.push(cur);
  for (const g of groups) await send(`ticket_swap_leg ×${g.length} through fixture_amm (${g.map((k) => rec.legs[k].symbol).join(", ")})`, g.map((k) => swapIxs[k]), [alt]);
  for (let i = 0; i < 7; i++) legs[i].measuredDelta = (await amount(VAULTS[i])) - v0[i];
  T.legs = legs;
  const tk = coder.accounts.decode("DepositTicket", (await conn.getAccountInfo(ticket))!.data) as any;
  T.landedMask = tk.landed_mask;
  const s0 = await amount(ownerShare);
  await send("finalize_deposit (mints shares, refunds leftover USDC, closes the ticket)", [ix("finalize_deposit", {
    owner: owner.publicKey, basket, ticket, escrow, owner_usdc: ownerUsdc, share_mint: shareMint, owner_share_ata: ownerShare,
  }, { min_shares: bn(1) }, MINTS.flatMap((m: PublicKey, i: number) => [r(m), r(VAULTS[i])]))], [alt]);
  T.sharesMinted = (await amount(ownerShare)) - s0;
  T.ticketClosed = !(await conn.getAccountInfo(ticket));
  save();
  console.log(JSON.stringify({ sharesMinted: T.sharesMinted.toString(), groups, legs: legs.map((l) => [l.leg, l.expectedNet.toString(), l.measuredDelta.toString()]) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
