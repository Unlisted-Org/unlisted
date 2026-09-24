// Acceptance check (spec 03 §2): /v1/quote/redeem equals a real `redeem` transaction's measured payout,
// per leg, to the unit.
//
//   CLUSTER=devnet API=http://localhost:8905 IDL_PATH=<A's basket.json> BASKET_SHARE_MINT=<mint> \
//     node verify/redeem-payout.ts --shares <raw> [--mode in_kind] [--holder ~/.config/solana/stocklana/<key>.json] [--pause SYMBOL]
//
// 1. Raw-read every vault (R0), call /v1/quote/redeem, raw-read again (R1); R0 must equal R1.
// 2. Send `redeem` (A's program, IDL-encoded) from the holder immediately.
// 3. From the confirmed transaction's own meta: each vault's preTokenBalance must equal R1 (nothing
//    moved between quote and redeem), gross = vault pre - post, net = holder post - pre.
// 4. Compare per leg: gross == quote.gross_raw, net == quote.net_raw, fee == gross - net; claims: the
//    ticket's TicketLeg::Claim units == quote units. Also TicketLeg::Paid {amount, received} and the
//    Redeemed event are reported next to the measured numbers.
// --pause SYMBOL pauses that leg first (issuer scenario, recorded) and resumes it afterwards, so the
// quote's claim path is checked too.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from "../src/lib/web3.ts";
import { loadIdl, decodeAccount, decodeEvents } from "../src/lib/idl.ts";
import { ixRedeem, basketPda, redeemTicketPda } from "../src/lib/basket-client.ts";
import { ata } from "../src/lib/amm.ts";
import { TOKEN_2022_PROGRAM } from "../src/lib/token2022.ts";

const CLUSTER = process.env.CLUSTER ?? "devnet";
if (CLUSTER !== "devnet" && CLUSTER !== "local") throw new Error("devnet or local only");
const API = process.env.API ?? "http://localhost:8905";
const RPC = CLUSTER === "local" ? (process.env.LOCAL_RPC ?? "http://127.0.0.1:8901") : (process.env.DEVNET_RPC ?? "https://api.devnet.solana.com");
const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const KEY_DIR = join(homedir(), ".config", "solana", "stocklana");
const holderPath = resolve(arg("holder", join(KEY_DIR, "fixture-issuer.json"))!.replace(/^~/, homedir()));
if (!holderPath.startsWith(KEY_DIR + "/")) throw new Error("holder key must be under ~/.config/solana/stocklana/");
const holder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(holderPath, "utf8"))));
const idl = loadIdl(process.env.IDL_PATH!);
const shareMint = process.env.BASKET_SHARE_MINT!;
const shares = BigInt(arg("shares")!);
const mode = arg("mode", "in_kind")!;
const pauseSym = arg("pause");
const conn = new Connection(RPC, "confirmed");
const REPO = join(import.meta.dirname, "..", "..", "..");

async function rawAmounts(keys: string[]) {
  const r = await conn.getMultipleAccountsInfo(keys.map((k) => new PublicKey(k)), "confirmed");
  return r.map((a) => (a ? a.data.readBigUInt64LE(64).toString() : null));
}
const issuerScenario = (action: string) => execFileSync("node", [join(REPO, "scripts/scenarios/issuer.ts"), action, "--cluster", CLUSTER, "--symbol", pauseSym!, "--note", "verify/redeem-payout.ts"], { encoding: "utf8" });

const basket = basketPda(idl.address, shareMint).toBase58();
const bacc = await conn.getAccountInfo(new PublicKey(basket), "confirmed");
const b = decodeAccount(idl, "Basket", bacc!.data);
const legs = b.legs.slice(0, b.n_legs).map((l: any, i: number) => ({ index: i, mint: l.mint, vault: l.vault, user: ata(holder.publicKey, l.mint, TOKEN_2022_PROGRAM).toBase58() }));
if (pauseSym) issuerScenario("pause");

const R0 = await rawAmounts(legs.map((l: any) => l.vault));
const quote: any = await (await fetch(`${API}/v1/quote/redeem?shares=${shares}&mode=${mode}`)).json();
if (quote.error) throw new Error(quote.error);
const R1 = await rawAmounts(legs.map((l: any) => l.vault));
const stable = JSON.stringify(R0) === JSON.stringify(R1);

const nonce = BigInt(Date.now());
const ix = ixRedeem(idl, { owner: holder.publicKey.toBase58(), shareMint, nonce, shares, mode: mode === "in_kind" ? { kind: "InKind" } : { kind: "Usdc", min_usdc_out: 0n }, legs });
const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
tx.feePayer = holder.publicKey;
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
tx.recentBlockhash = blockhash;
tx.sign(holder);
const sig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
if (pauseSym) issuerScenario("resume");
if (!t || t.meta?.err) throw new Error(`redeem failed: ${JSON.stringify(t?.meta?.err)} ${t?.meta?.logMessages?.slice(-5).join(" | ")}`);

const keys = t.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
const bal = (list: any[], acct: string) => { const e = list.find((x) => keys[x.accountIndex] === acct); return e ? BigInt(e.uiTokenAmount.amount) : 0n; };
const ticket = decodeAccount(idl, "RedemptionTicket", (await conn.getAccountInfo(redeemTicketPda(idl.address, basket, holder.publicKey.toBase58(), nonce), "confirmed"))!.data);
const events = decodeEvents(idl, t.meta!.logMessages ?? [], idl.address);
const redeemed = events.find((e) => e.name === "Redeemed")?.data;

const rows: any[] = [];
let ok = stable;
for (const q of quote.legs) {
  const l = legs[q.index];
  const tl = ticket.legs[q.index];
  if (q.action === "claim") {
    const good = tl.kind === "Claim" && tl.units === q.units;
    ok &&= good;
    rows.push({ index: q.index, symbol: q.symbol, action: "claim", quote_units: q.units, ticket_leg: tl, match: good });
    continue;
  }
  const vPre = bal(t.meta!.preTokenBalances!, l.vault), vPost = bal(t.meta!.postTokenBalances!, l.vault);
  const uPre = bal(t.meta!.preTokenBalances!, l.user), uPost = bal(t.meta!.postTokenBalances!, l.user);
  const gross = vPre - vPost, net = uPost - uPre;
  const preMatchesQuoteTime = vPre.toString() === R1[q.index];
  const good = preMatchesQuoteTime && gross.toString() === q.gross_raw && (mode !== "in_kind" || net.toString() === q.net_raw);
  ok &&= good;
  rows.push({ index: q.index, symbol: q.symbol, action: q.action, quote_gross_raw: q.gross_raw, measured_gross_raw: gross.toString(), quote_net_raw: q.net_raw ?? null, measured_net_raw: net.toString(), quote_fee_raw: q.fee_raw, measured_fee_raw: (gross - net).toString(),
    vault_pre_in_tx: vPre.toString(), vault_at_quote: R1[q.index], ticket_leg: tl, redeemed_event_paid: redeemed?.paid?.[q.index] ?? null, match: good });
}
for (const r of rows) console.log(`${r.symbol}: ${r.action} ${r.action === "claim" ? `units quote ${r.quote_units} ticket ${JSON.stringify(r.ticket_leg)}` : `gross quote ${r.quote_gross_raw} measured ${r.measured_gross_raw}; net quote ${r.quote_net_raw} measured ${r.measured_net_raw}`} ${r.match ? "OK" : "MISMATCH"}`);
console.log(`redeem ${sig} slot ${t.slot}; quote slot ${quote.as_of_slot}; vaults unchanged across quote: ${stable} -> ${ok ? "ALL MATCH TO THE UNIT" : "FAILED"}`);
const out = join(import.meta.dirname, "out", `redeem-payout-${CLUSTER}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ check: "/v1/quote/redeem vs measured redeem payout, per leg, to the unit", cluster: CLUSTER, program: idl.address, basket, share_mint: shareMint, holder: holder.publicKey.toBase58(), shares: shares.toString(), mode, paused_leg: pauseSym ?? null,
  quote_slot: quote.as_of_slot, redeem_signature: sig, redeem_slot: t.slot, vaults_stable_across_quote: stable, legs: rows, redeemed_event: redeemed ?? null, events: events.map((e) => e.name), all_match: ok }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
console.log(out);
process.exit(ok ? 0 : 1);
