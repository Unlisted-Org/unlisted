// Acceptance check (spec 03 §1, second half): every sell_now leg in /v1/basket matches a mainnet
// simulateTransaction of the quoted route to within ±0.1%.
//
//   API=http://localhost:8905 node verify/sell-sim.ts [--out <file>] [--negative-control]
//
// --negative-control: quote the same amounts with Manifest ALLOWED and compare quote vs simulation.
// The check must fail for legs Jupiter routes through Manifest (it over-quotes by the transfer fee);
// if it passed there, it would not be a check.
//
// Independence: the API's figure is Jupiter's quoted outAmount. This script takes the route the API
// quoted (same mint, same raw amount, excludeDexes=Manifest,1DEX), builds the transaction for a taker that
// really holds the input, simulates it on mainnet (sigVerify off, blockhash replaced: nothing is signed
// or sent), and reads the taker's USDC account after the simulation. Delivered = post - pre.
// It fails when the quote does not deliver: e.g. a Manifest route, which over-quotes by the 1% fee.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from "../src/lib/web3.ts";
import { Rpc } from "../src/lib/rpc.ts";
import { jupiterSellQuote } from "../src/lib/sources.ts";
import { ata } from "../src/lib/amm.ts";
import { MAINNET_USDC, TOKEN_PROGRAM } from "../src/lib/token2022.ts";

const API = process.env.API ?? "http://localhost:8905";
const TOL = 0.001;
const mainnet = new Rpc("mainnet");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function holder(mint: string, amount: bigint): Promise<string> {
  const r = await mainnet.call("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
  const accs = await mainnet.accounts(r.value.map((x: any) => x.address));
  for (let i = 0; i < r.value.length; i++) {
    const owner = accs.values[i]?.data?.parsed?.info?.owner;
    if (owner && PublicKey.isOnCurve(new PublicKey(owner).toBytes()) && BigInt(r.value[i].amount) >= amount) return owner;
  }
  throw new Error(`no on-curve holder with ${amount} of ${mint}`);
}

const toIx = (i: any) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.accounts.map((a: any) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, "base64"),
});

async function simulate(build: any, taker: string) {
  // (build = the /build response for the same mint, amount and route parameters as the API's quote)
  const ixs = [...(build.computeBudgetInstructions ?? []), ...(build.setupInstructions ?? []), build.swapInstruction, ...(build.cleanupInstruction ? [build.cleanupInstruction] : []), ...(build.otherInstructions ?? [])].map(toIx);
  const alts = Object.entries(build.addressesByLookupTableAddress ?? {}).map(([k, addrs]: any) => new AddressLookupTableAccount({ key: new PublicKey(k), state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: addrs.map((a: string) => new PublicKey(a)) } }));
  const msg = new TransactionMessage({ payerKey: new PublicKey(taker), recentBlockhash: PublicKey.default.toBase58(), instructions: ixs }).compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  const usdcAta = ata(taker, MAINNET_USDC, TOKEN_PROGRAM).toBase58();
  const pre = await mainnet.account(usdcAta);
  const preAmt = BigInt(pre.value?.data?.parsed?.info?.tokenAmount?.amount ?? "0");
  const r = await mainnet.call("simulateTransaction", [Buffer.from(tx.serialize()).toString("base64"), {
    encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed",
    accounts: { addresses: [usdcAta], encoding: "jsonParsed" },
  }]);
  const post = r.value.accounts?.[0]?.data?.parsed?.info?.tokenAmount?.amount;
  return { slot: r.context.slot, err: r.value.err, units: r.value.unitsConsumed, usdc_ata: usdcAta, pre: preAmt.toString(), post: post ?? null, delivered: post ? (BigInt(post) - preAmt).toString() : null, logs_tail: (r.value.logs ?? []).slice(-3) };
}

const negative = process.argv.includes("--negative-control");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. Resolve a real holder per leg first (slow, rate-limited), so step 3 can run right after the quote.
const warm: any = await (await fetch(`${API}/v1/basket`)).json();
const takers: Record<string, string> = {};
for (const leg of warm.values.sell_now.legs) {
  const mint = warm.legs[leg.index].mirror_of;
  for (let i = 0; i < 6 && !takers[mint]; i++) {
    try { takers[mint] = await holder(mint, BigInt(leg.amount_raw) * 4n); } catch (e) { await sleep(3000 * (i + 1)); }
  }
}
// 2. A fresh API computation: these are the figures under test.
const basket: any = await (await fetch(`${API}/v1/basket?include_builds=1`)).json();
const apiDone = Date.now();
// 3. For each leg, immediately: build the same route for a real holder and simulate it.
const rows: any[] = [];
let fail = 0;
for (const leg of basket.values.sell_now.legs) {
  const mint = basket.legs[leg.index].mirror_of;
  const amount = BigInt(leg.amount_raw);
  const taker = leg.taker_holds_input ? leg.taker : takers[mint];
  try {
    if (!taker) throw new Error("no holder found to simulate with");
    // Positive check: simulate the API's own quoted transaction when its taker holds the input;
    // otherwise (or for the negative control) build the same route for a real holder.
    const own = !negative && leg.taker_holds_input && leg.build;
    const q = own ? { build: leg.build, out_usdc_raw: leg.out_usdc_raw } : await jupiterSellQuote(mint, amount, taker, { includeManifest: negative });
    const sim = await simulate(q.build, taker);
    const quoted = BigInt(negative ? q.out_usdc_raw : leg.out_usdc_raw);
    const delivered = sim.delivered ? BigInt(sim.delivered) : null;
    const diff = delivered !== null ? Number(delivered - quoted) / Number(quoted) : null;
    const diffSame = delivered !== null ? Number(delivered - BigInt(q.out_usdc_raw)) / Number(q.out_usdc_raw) : null;
    const ok = !sim.err && diff !== null && Math.abs(diff) <= TOL;
    if (!ok) fail++;
    rows.push({ index: leg.index, symbol: leg.symbol, mint, amount_raw: leg.amount_raw, api_out_usdc_raw: leg.out_usdc_raw, api_route: leg.route, api_quoted_at_slot: leg.quoted_at_slot,
      seconds_after_api: Math.round((Date.now() - apiDone) / 1000),
      simulated_route: [...new Set(q.build.routePlan.map((r: any) => r.swapInfo.label))].join(" + "), same_instant_quote_out_usdc_raw: q.out_usdc_raw, taker, taker_from_api: Boolean(leg.taker_holds_input), simulated_the_apis_own_build: Boolean(own),
      simulation: sim, delivered_vs_api: diff === null ? null : `${(diff * 100).toFixed(4)}%`, delivered_vs_same_instant_quote: diffSame === null ? null : `${(diffSame * 100).toFixed(4)}%`, within_0_1pct: ok });
    console.log(`${leg.symbol}: api ${leg.out_usdc_raw} sim ${sim.delivered} vs api ${diff === null ? "n/a" : (diff * 100).toFixed(4) + "%"} vs same-instant quote ${diffSame === null ? "n/a" : (diffSame * 100).toFixed(4) + "%"} ${ok ? "OK" : "FAIL"} ${sim.err ? JSON.stringify(sim.err) : ""} slot ${sim.slot}`);
  } catch (e: any) {
    fail++;
    rows.push({ index: leg.index, symbol: leg.symbol, error: String(e?.message ?? e) });
    console.log(`${leg.symbol}: ERROR ${e?.message ?? e}`);
  }
}
const out = arg("out") ?? join(import.meta.dirname, "out", `sell-sim${negative ? "-negative" : ""}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ check: negative ? "NEGATIVE CONTROL: Manifest-allowed quote vs its own simulation" : "sell_now leg vs mainnet simulateTransaction of the quoted route, tolerance ±0.1%", api: API, basket_as_of: basket.as_of, tolerance: TOL, legs: rows, all_ok: fail === 0 }, null, 1));
console.log(`${fail ? "FAILED" : "ALL OK"} -> ${out}`);
process.exit(fail ? 1 : 0);
