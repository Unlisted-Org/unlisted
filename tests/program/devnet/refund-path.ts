// The user's refund path on the canonical devnet basket, through C's fixture_amm:
//   open_deposit_ticket → (a ticket-owned intermediate token account, as a Jupiter route creates) →
//   ticket_swap_leg ×3 → unwind_leg ×3 (basket-signed sell back to USDC into the escrow) → abort_deposit.
// Broken versions first, each caught before the real one lands:
//   (a) abort_deposit while legs are still landed: refused by the program (LegsStillLanded);
//   (b) abort_deposit that skips the intermediate: simulated; this script's "nothing left behind" check on the
//       simulated post-state fails (the intermediate stays open with the owner's rent in it).
// Checks: every leg's unwind proceeds equal the pool's output to the unit; vaults return to their balance
// before the ticket; owner USDC after = before − usdc_in + escrow at abort (= unspent + unwind proceeds);
// owner SOL after = before − the fees of this run's transactions (all rent returned); no ticket-owned
// account survives. Usage: node --import tsx devnet/refund-path.ts <registry.json>
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
const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, { commitment: "confirmed", fetch: politeFetch as any, disableRetryOnRateLimit: true });
const OUT = process.env.REFUND_OUT ?? path.join(ROOT, "tests/program/devnet/refund-path.json");
const can = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/program/devnet/canonical.json"), "utf8"));
const reg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME!, ".config/solana/stocklana/program.json"), "utf8"))));
const bn = (x: bigint | number) => new BN(x.toString());
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const basket = new PublicKey(can.basket), USDC = new PublicKey(can.usdcMint);
const AMM = new PublicKey(reg.fixture_amm.program_id);
const MINTS: PublicKey[] = can.legs.map((l: any) => new PublicKey(l.mint));
const VAULTS: PublicKey[] = can.legs.map((l: any) => new PublicKey(l.vault));
const LEGS = (process.env.REFUND_LEGS ?? "0,1,2").split(",").map(Number);
const USDC_PER_LEG = 1_000_000n;
const rec: any = { scenario: "refund-path", cluster: RPC.includes("devnet") ? "devnet" : RPC, rpc: RPC, program: PROGRAM_ID.toBase58(), basket: basket.toBase58(),
  router: AMM.toBase58(), owner: owner.publicKey.toBase58(), startedAt: new Date().toISOString(), steps: [] as any[], checks: [] as any[] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(rec, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));
const fees: bigint[] = [];

function check(what: string, ok: boolean, detail: any = {}) {
  rec.checks.push({ what, ok, ...detail });
  save();
  console.log(`  ${ok ? "✔" : "✖"} ${what}`);
  if (!ok) throw new Error("check failed: " + what + " " + JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function build(ixs: TransactionInstruction[], alts: AddressLookupTableAccount[]) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs] }).compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  tx.sign([owner]);
  return { tx, lastValidBlockHeight };
}

async function send(label: string, ixs: TransactionInstruction[], alts: AddressLookupTableAccount[]) {
  let prev: string | undefined;
  for (let attempt = 0; ; attempt++) {
    if (prev) {
      const st = (await conn.getSignatureStatuses([prev], { searchTransactionHistory: true })).value[0];
      if (st && !st.err && st.confirmationStatus) return done(label, prev);
    }
    const { tx, lastValidBlockHeight } = await build(ixs, alts);
    try {
      prev = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 });
      for (;;) {
        const st = (await conn.getSignatureStatuses([prev])).value[0];
        if (st?.err) throw Object.assign(new Error(`${label}: ${JSON.stringify(st.err)}`), { landed: true });
        if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return done(label, prev);
        if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("block height exceeded");
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } catch (e: any) {
      if (!e.landed && attempt < 5 && /blockhash|429|block height exceeded|fetch failed/i.test(String(e.message))) continue;
      rec.steps.push({ label, ok: false, error: String(e.message).slice(0, 600), logs: e.logs });
      save();
      throw e;
    }
  }
}
async function done(label: string, sig: string) {
  let t = null;
  for (let k = 0; k < 20 && !t; k++) {
    t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!t) await new Promise((ok) => setTimeout(ok, 1500));
  }
  const logs = t?.meta?.logMessages ?? [];
  fees.push(BigInt(t?.meta?.fee ?? 0));
  rec.steps.push({ label, signature: sig, slot: t?.slot, fee: t?.meta?.fee, cu: t?.meta?.computeUnitsConsumed,
    cpiDepth: Math.max(0, ...logs.map((l) => Number(l.match(/invoke \[(\d+)\]/)?.[1] ?? 0))), events: parseEvents(logs).map((e) => ({ name: e.name, data: e.data })) });
  save();
  console.log(`${label}: ${sig}`);
  return sig;
}

/** A broken version: simulate the signed transaction (never sent) and return the result and post-state. */
async function simulate(label: string, ixs: TransactionInstruction[], alts: AddressLookupTableAccount[], watch: PublicKey[]) {
  const { tx } = await build(ixs, alts);
  const sim = await conn.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: watch.map((k) => k.toBase58()) } });
  const logs = sim.value.logs ?? [];
  const step = { label, simulated: true, simulatedAtSlot: sim.context.slot, err: sim.value.err, errorCode: logs.map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean),
    logs: logs.filter((l) => /Instruction:|Error|failed/.test(l)),
    postState: sim.value.accounts?.map((a, i) => ({ account: watch[i].toBase58(), exists: !!a && a.lamports > 0, lamports: a?.lamports ?? 0 })) };
  rec.steps.push(step);
  save();
  console.log(`${label}: simulated (${step.errorCode ?? (step.err ? JSON.stringify(step.err) : "ok")})`);
  return step;
}

const amount = async (a: PublicKey) => { const i = await conn.getAccountInfo(a, "confirmed"); return i ? i.data.readBigUInt64LE(64) : 0n; };
const decodeBasket = async () => coder.accounts.decode("Basket", (await conn.getAccountInfo(basket, "confirmed"))!.data) as any;
async function transferFee(mint: PublicKey, amt: bigint) {
  const m = await spl.getMint(conn, mint, "confirmed", T22);
  const epoch = BigInt((await conn.getEpochInfo("confirmed")).epoch);
  return spl.calculateEpochFee(spl.getTransferFeeConfig(m)!, epoch, amt);
}
const pool = (i: number) => reg.fixture_amm.pools.find((x: any) => x.leg_mint === MINTS[i].toBase58());

/** "Nothing left behind", checked on the abort instruction before it is sent: every token account the ticket
 *  PDA owns right now (both token programs) must be among the accounts the abort closes. Returns the ones missing. */
async function leftBehind(ticket: PublicKey, escrow: PublicKey, abort: TransactionInstruction) {
  const owned = [...(await conn.getTokenAccountsByOwner(ticket, { programId: TOKEN }, "confirmed")).value, ...(await conn.getTokenAccountsByOwner(ticket, { programId: T22 }, "confirmed")).value]
    .map((a) => a.pubkey.toBase58());
  const closes = new Set([escrow.toBase58(), ...abort.keys.slice(7).map((k) => k.pubkey.toBase58())]);
  return { owned, missing: owned.filter((k) => !closes.has(k)) };
}

async function main() {
  if (!(await conn.getAccountInfo(PROGRAM_ID))?.executable) throw new Error("program not deployed at " + RPC);
  const alt = (await conn.getAddressLookupTable(new PublicKey(can.lookupTable))).value!;
  const ownerUsdc = spl.getAssociatedTokenAddressSync(USDC, owner.publicKey, false, TOKEN);
  let nonce = Number(process.env.TICKET_NONCE ?? 100);
  const pda = (n: number) => PublicKey.findProgramAddressSync([Buffer.from("deposit"), basket.toBuffer(), owner.publicKey.toBuffer(), u64le(n)], PROGRAM_ID)[0];
  while (await conn.getAccountInfo(pda(nonce), "confirmed")) nonce++;
  const ticket = pda(nonce);
  const escrow = spl.getAssociatedTokenAddressSync(USDC, ticket, true, TOKEN);
  const inter = spl.getAssociatedTokenAddressSync(MINTS[LEGS[0]], ticket, true, T22);
  const usdcIn = USDC_PER_LEG * BigInt(LEGS.length);
  const L0 = BigInt(await conn.getBalance(owner.publicKey, "confirmed"));
  const U0 = await amount(ownerUsdc);
  const V0 = await Promise.all(VAULTS.map(amount));
  const B0 = await decodeBasket();
  Object.assign(rec, { ticket: ticket.toBase58(), nonce, escrow: escrow.toBase58(), intermediate: inter.toBase58(), legs: LEGS.map((i) => can.legs[i].symbol), usdcIn,
    before: { ownerLamports: L0, ownerUsdc: U0, vaults: LEGS.map((i) => V0[i]) } });
  save();

  await send(`open_deposit_ticket (${LEGS.length} × $1 fixture USDC)`, [ix("open_deposit_ticket", { owner: owner.publicKey, basket, ticket, escrow, owner_usdc: ownerUsdc, usdc_mint: USDC },
    { nonce: bn(nonce), usdc_in: bn(usdcIn), expiry_slots: bn(1500) }, MINTS.flatMap((m, i) => [r(m), r(VAULTS[i])]))], [alt]);
  await send(`create a ticket-owned intermediate (Token-2022 ${can.legs[LEGS[0]].symbol} account, as a Jupiter route's taker output)`,
    [spl.createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, inter, ticket, MINTS[LEGS[0]], T22)], [alt]);

  const swaps = LEGS.map((i) => {
    const p = pool(i);
    const route = [w(new PublicKey(p.pool)), r(MINTS[i]), r(USDC), w(new PublicKey(p.leg_vault)), w(new PublicKey(p.usdc_vault)), r(ticket), w(escrow), w(VAULTS[i]), r(T22), r(TOKEN)];
    return ix("ticket_swap_leg", { owner: owner.publicKey, basket, ticket, escrow, leg_mint: MINTS[i], leg_vault: VAULTS[i], router_program: AMM },
      { leg: i, usdc_amount: bn(USDC_PER_LEG), min_out: bn(1), route_data: Buffer.concat([Buffer.from([1]), u64le(USDC_PER_LEG), u64le(0n), Buffer.from([0])]) }, route);
  });
  await send(`ticket_swap_leg ×${LEGS.length} through fixture_amm (${rec.legs.join(", ")})`, swaps, [alt]);
  const tk = coder.accounts.decode("DepositTicket", (await conn.getAccountInfo(ticket, "confirmed"))!.data) as any;
  const landed = LEGS.map((i) => ({ leg: can.legs[i].symbol, vaultDelta: 0n, amount: 0n }));
  for (const [k, i] of LEGS.entries()) landed[k].vaultDelta = (await amount(VAULTS[i])) - V0[i];
  check(`all ${LEGS.length} legs landed (landed_mask ${tk.landed_mask})`, LEGS.every((i) => (tk.landed_mask & (1 << i)) !== 0));
  const escAfterSwaps = await amount(escrow);
  rec.escrowAfterSwaps = escAfterSwaps;

  const abortIx = (extra: PublicKey[]) => ix("abort_deposit", { owner: owner.publicKey, basket, ticket, escrow, owner_usdc: ownerUsdc }, {}, extra.map(w));
  // Broken version (a): abort while legs are still landed.
  const bad1 = await simulate("BROKEN (a): abort_deposit before unwinding the landed legs", [abortIx([inter])], [alt], [ticket, escrow, inter]);
  check("broken (a) refused by the program with LegsStillLanded", bad1.errorCode === "LegsStillLanded", { got: bad1.errorCode ?? bad1.err });

  // unwind every landed leg: basket-signed sell of exactly the ticket's delta, USDC into the escrow.
  const unwound: any[] = [];
  for (const i of LEGS) {
    const b = await decodeBasket();
    const t = coder.accounts.decode("DepositTicket", (await conn.getAccountInfo(ticket, "confirmed"))!.data) as any;
    const amt = BigInt(new BN(t.norm[i]).mul(new BN(b.legs[i].loss_index)).div(new BN(10).pow(new BN(18))).toString());
    const p = pool(i);
    const [legRes, usdcRes] = [await amount(new PublicKey(p.leg_vault)), await amount(new PublicKey(p.usdc_vault))];
    const fee = await transferFee(MINTS[i], amt);
    const arrived = amt - fee;
    const inAfterLp = (arrived * BigInt(10_000 - reg.fixture_amm.lp_fee_bps)) / 10_000n;
    const expectUsdc = (usdcRes * inAfterLp) / (legRes + inAfterLp);
    const e0 = await amount(escrow), v0 = await amount(VAULTS[i]);
    const route = [w(new PublicKey(p.pool)), r(MINTS[i]), r(USDC), w(new PublicKey(p.leg_vault)), w(new PublicKey(p.usdc_vault)), r(basket), w(VAULTS[i]), w(escrow), r(T22), r(TOKEN)];
    await send(`unwind_leg ${can.legs[i].symbol}: sell ${amt} raw back to USDC into the escrow (basket-signed, fixture_amm)`, [ix("unwind_leg", {
      owner: owner.publicKey, basket, ticket, escrow, leg_mint: MINTS[i], leg_vault: VAULTS[i], router_program: AMM,
    }, { leg: i, min_usdc_out: bn((expectUsdc * 98n) / 100n), route_data: Buffer.concat([Buffer.from([1]), u64le(amt), u64le(0n), Buffer.from([1])]) }, route)], [alt]);
    const got = (await amount(escrow)) - e0, sold = v0 - (await amount(VAULTS[i]));
    unwound.push({ leg: can.legs[i].symbol, amount: amt, transferFee: fee, expectedUsdc: expectUsdc, escrowDelta: got, vaultDecrease: sold });
    check(`${can.legs[i].symbol}: vault gave back exactly the ticket's ${amt} raw; escrow +${got} = pool output ${expectUsdc}`, sold === amt && got === expectUsdc);
  }
  rec.unwinds = unwound;
  const Vmid = await Promise.all(VAULTS.map(amount));
  check("each unwound vault is back at its balance before the ticket", LEGS.every((i) => Vmid[i] === V0[i]), { before: LEGS.map((i) => V0[i]), after: LEGS.map((i) => Vmid[i]) });
  const B1 = await decodeBasket();
  check("basket pending_norm and accounted restored for the unwound legs", LEGS.every((i) => String(B1.legs[i].pending_norm) === String(B0.legs[i].pending_norm) && String(B1.legs[i].accounted) === String(Vmid[i])));
  const t2 = coder.accounts.decode("DepositTicket", (await conn.getAccountInfo(ticket, "confirmed"))!.data) as any;
  check("ticket landed_mask is 0 after the unwinds", t2.landed_mask === 0);
  const escAtAbort = await amount(escrow);
  const proceeds = unwound.reduce((a, u) => a + u.escrowDelta, 0n);
  check(`escrow at abort ${escAtAbort} = after swaps ${escAfterSwaps} + unwind proceeds ${proceeds}`, escAtAbort === escAfterSwaps + proceeds);

  // Broken version (b): abort that skips closing the intermediate. The program accepts it (it closes only what
  // it is given); this script's "nothing left behind" check catches it on the simulated post-state.
  const badIx = abortIx([]);
  const bad2 = await simulate("BROKEN (b): abort_deposit that skips the ticket-owned intermediate", [badIx], [alt], [ticket, escrow, inter]);
  const lb = await leftBehind(ticket, escrow, badIx);
  const interLamports = (await conn.getAccountInfo(inter, "confirmed"))!.lamports;
  rec.brokenCaught = { version: "abort skips the intermediate", programAccepts: !bad2.err, ticketOwnedAccounts: lb.owned, notClosedByTheAbort: lb.missing, strandedRentLamports: interLamports,
    simulatedPostStateOfIntermediate: bad2.postState?.[2] };
  check(`broken (b) caught: the program would accept it (simulation ${bad2.err ? "failed" : "ok"}), but the check finds ${lb.missing.length} ticket-owned account not closed (${interLamports} lamports of the owner's rent stranded)`,
    !bad2.err && lb.missing.length === 1 && lb.missing[0] === inter.toBase58(), { missing: lb.missing });

  // The real abort.
  const goodIx = abortIx([inter]);
  const lbGood = await leftBehind(ticket, escrow, goodIx);
  check("the real abort closes every ticket-owned account", lbGood.missing.length === 0, { owned: lbGood.owned });
  const ownerUsdcBefore = await amount(ownerUsdc);
  await send("abort_deposit (escrow → owner, closes escrow, intermediate and ticket; rent → owner)", [goodIx], [alt]);
  const gone = await Promise.all([ticket, escrow, inter].map((k) => conn.getAccountInfo(k, "confirmed")));
  const owned = await conn.getTokenAccountsByOwner(ticket, { programId: TOKEN });
  const owned22 = await conn.getTokenAccountsByOwner(ticket, { programId: T22 });
  check("nothing left behind: ticket, escrow and intermediate closed; no token account owned by the ticket", gone.every((g) => !g) && owned.value.length === 0 && owned22.value.length === 0);
  const U1 = await amount(ownerUsdc);
  check(`owner received the escrow: +${U1 - ownerUsdcBefore} = ${escAtAbort}`, U1 - ownerUsdcBefore === escAtAbort);
  check(`owner USDC: before ${U0} − usdc_in ${usdcIn} + unspent ${escAfterSwaps} + unwind proceeds ${proceeds} = ${U1}`, U1 === U0 - usdcIn + escAfterSwaps + proceeds);
  const L1 = BigInt(await conn.getBalance(owner.publicKey, "confirmed"));
  const feeSum = fees.reduce((a, b) => a + b, 0n);
  check(`owner SOL: before ${L0} − fees ${feeSum} = after ${L1} (every rent lamport returned)`, L1 === L0 - feeSum);
  rec.after = { ownerLamports: L1, ownerUsdc: U1, feesPaid: feeSum, netUsdcCost: U0 - U1 };
  rec.finishedAt = new Date().toISOString();
  rec.passed = rec.checks.every((c: any) => c.ok);
  save();
  console.log(`net cost of the round trip: ${U0 - U1} fixture USDC raw (AMM LP fees + 1% leg transfer fees both ways) and ${feeSum} lamports of fees`);
}
main().catch((e) => { console.error(e); process.exit(1); });
