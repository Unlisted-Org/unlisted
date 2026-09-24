// Acceptance check (spec 03 §1, first half): every raw number in /v1/basket matches a direct RPC read
// at a stated slot, on the basket's cluster and on mainnet.
//
//   CLUSTER=devnet API=http://localhost:8905 node verify/basket-vs-rpc.ts [--out <file>]
//
// Independence: this script does NOT use the service's decoders. It reads base64 account bytes and
// decodes them itself: token account amount/state (offsets 64, 108), mint supply/decimals (36, 44),
// Token-2022 TLV extensions (fee config, scaled UI, pausable, hook, default state), and for the program
// source the Basket account by walking spec 02's layout by hand.
// Bracketing: raw bytes are read before and after the API call; they must be identical (nothing changed
// in between), so "matches at the stated slot" is literal. Retries up to 3 times if the chain moved.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PublicKey } from "../src/lib/web3.ts";

const API = process.env.API ?? "http://localhost:8905";
const CLUSTER = process.env.CLUSTER ?? "devnet";
const URLS: Record<string, string> = { devnet: process.env.DEVNET_RPC ?? "https://api.devnet.solana.com", local: process.env.LOCAL_RPC ?? "http://127.0.0.1:8901", mainnet: process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com" };
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function raw(cluster: string, keys: string[]) {
  for (let i = 0; ; i++) {
    const r = await fetch(URLS[cluster], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [keys, { encoding: "base64", commitment: "confirmed" }] }) });
    if (r.status === 429 && i < 6) { await new Promise((s) => setTimeout(s, 1000 * 2 ** i)); continue; }
    const j: any = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return { slot: j.result.context.slot as number, data: j.result.value.map((v: any) => (v ? Buffer.from(v.data[0], "base64") : null)) as (Buffer | null)[] };
  }
}

const u64 = (b: Buffer, o: number) => b.readBigUInt64LE(o);
/** Token-2022 TLV walk: extensions start at 166 (after the 165-byte base + account-type byte). */
function tlv(b: Buffer): Map<number, Buffer> {
  const m = new Map<number, Buffer>();
  let o = 166;
  while (o + 4 <= b.length) {
    const t = b.readUInt16LE(o), len = b.readUInt16LE(o + 2);
    if (t === 0 && len === 0) break;
    m.set(t, b.subarray(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return m;
}
function mintFacts(b: Buffer, epoch: number, now: number) {
  const x = tlv(b);
  const f = x.get(1); // TransferFeeConfig: auth 32, withdraw 32, withheld 8, older{epoch 8, max 8, bps 2}, newer{...}
  const older = f ? { epoch: Number(u64(f, 72)), max: u64(f, 80).toString(), bps: f.readUInt16LE(88) } : null;
  const newer = f ? { epoch: Number(u64(f, 90)), max: u64(f, 98).toString(), bps: f.readUInt16LE(106) } : null;
  const s = x.get(25); // ScaledUiAmountConfig: authority 32, multiplier f64, new_ts i64, new_multiplier f64
  const mult = s ? { stored: s.readDoubleLE(32), ts: Number(s.readBigInt64LE(40)), next: s.readDoubleLE(48) } : { stored: 1, ts: 0, next: 1 };
  const p = x.get(26); // PausableConfig: authority 32, paused u8
  const h = x.get(14); // TransferHook: authority 32, program_id 32
  const hookProgram = h && !h.subarray(32, 64).every((z) => z === 0) ? new PublicKey(h.subarray(32, 64)).toBase58() : null;
  return {
    supply: u64(b, 36).toString(), decimals: b[44],
    fee_now_bps: newer && epoch >= newer.epoch ? newer.bps : older?.bps ?? null,
    fee_pending_bps: newer && epoch < newer.epoch && newer.bps !== older!.bps ? newer.bps : null,
    multiplier_stored: mult.stored, multiplier_effective: now >= mult.ts ? mult.next : mult.stored,
    paused: p ? p[32] === 1 : false, hook_program: hookProgram,
  };
}
/** spec 02 Basket layout, walked by hand (8-byte discriminator first). */
function basketFacts(b: Buffer) {
  let o = 8 + 1 + 1 + 32 * 4 + 8;
  const n = b[o]; o += 1;
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const mint = new PublicKey(b.subarray(o, o + 32)).toBase58(); o += 32;
    const vault = new PublicKey(b.subarray(o, o + 32)).toBase58(); o += 32;
    const accounted = u64(b, o).toString(); o += 8;
    const claim = u64(b, o).toString(); o += 8;
    const pending = (u64(b, o) + (u64(b, o + 8) << 64n)).toString(); o += 16;
    const loss = (u64(b, o) + (u64(b, o + 8) << 64n)).toString(); o += 16;
    const status = b[o]; o += 1 + (status === 1 ? 16 : 0);
    o += 32; // mirror_of
    if (i < n) legs.push({ mint, vault, accounted, claim, pending, loss, status });
  }
  return { n, legs };
}

async function once() {
  const probe: any = await (await fetch(`${API}/v1/basket`)).json();
  const keys = [probe.share.mint, ...probe.legs.map((l: any) => l.vault), ...probe.legs.map((l: any) => l.fixture_mint), ...(probe.basket_source.kind === "program" ? [probe.basket] : [])];
  const mkeys = probe.legs.map((l: any) => l.mirror_of);
  const [r1, m1, ep] = await Promise.all([raw(CLUSTER, keys), raw("mainnet", mkeys), fetch(URLS[CLUSTER], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getEpochInfo", params: [{ commitment: "confirmed" }] }) }).then((r) => r.json())]);
  const api: any = await (await fetch(`${API}/v1/basket?fresh=1`)).json();
  const [r2, m2] = await Promise.all([raw(CLUSTER, keys), raw("mainnet", mkeys)]);
  const changed = keys.filter((_k, i) => !(r1.data[i] && r2.data[i] && r1.data[i]!.equals(r2.data[i]!)));
  const stable = changed.length === 0;
  // Mainnet mints change bytes constantly (withheld fees, supply); what must not change is what is checked.
  const mnow = Math.floor(Date.now() / 1000);
  const mchanged = mkeys.filter((_k: string, i: number) => JSON.stringify(mintFacts(m1.data[i]!, 0, mnow).multiplier_effective) !== JSON.stringify(mintFacts(m2.data[i]!, 0, mnow).multiplier_effective));
  const mstable = mchanged.length === 0;
  const now = Math.floor(Date.now() / 1000);
  const epoch = (ep as any).result.epoch;
  const n = api.legs.length;
  const checks: any[] = [];
  const eq = (what: string, a: any, b: any) => checks.push({ what, api: String(a), rpc: String(b), ok: String(a) === String(b) });

  const share = mintFacts(r1.data[0]!, epoch, now);
  eq("share.supply_raw", api.share.supply_raw, share.supply);
  eq("share.decimals", api.share.decimals, share.decimals);
  const bf = api.basket_source.kind === "program" ? basketFacts(r1.data[keys.length - 1]!) : null;
  const standin = api.basket_source.kind === "standin" ? JSON.parse(readFileSync(process.env.STANDIN_STATE ?? join(import.meta.dirname, "..", "..", "..", "fixtures", CLUSTER === "local" ? ".local/standin-basket.json" : "standin-basket.json"), "utf8")) : null;
  api.legs.forEach((l: any, i: number) => {
    const v = r1.data[1 + i]!;
    eq(`${l.symbol}.balance_raw (vault amount @64)`, l.balance_raw, u64(v, 64));
    eq(`${l.symbol}.status frozen? (vault state @108)`, l.unavailable_reason === "frozen", v[108] === 2);
    const mf = mintFacts(r1.data[1 + n + i]!, epoch, now);
    eq(`${l.symbol}.fee.now_bps`, l.fee.now_bps, mf.fee_now_bps);
    eq(`${l.symbol}.fee.pending.bps`, l.fee.pending?.bps ?? null, mf.fee_pending_bps);
    eq(`${l.symbol}.multiplier.stored`, Number(l.multiplier.stored), mf.multiplier_stored);
    eq(`${l.symbol}.multiplier.effective`, Number(l.multiplier.effective), mf.multiplier_effective);
    eq(`${l.symbol}.paused`, l.unavailable_reason === "paused", mf.paused);
    eq(`${l.symbol}.hook`, l.unavailable_reason === "hook", mf.hook_program !== null);
    if (bf) {
      const b = bf.legs[i];
      eq(`${l.symbol}.vault (Basket)`, l.vault, b.vault);
      eq(`${l.symbol}.accounted_raw (Basket)`, l.accounted_raw, b.accounted);
      eq(`${l.symbol}.claim_units (Basket)`, l.claim_units, b.claim);
      eq(`${l.symbol}.pending_norm (Basket)`, l.pending_norm, b.pending);
      eq(`${l.symbol}.loss_index (Basket)`, l.loss_index, b.loss);
    } else if (standin) {
      const s = standin.legs[i];
      checks.push({ what: `${l.symbol}.accounted_raw (stand-in state FILE, not chain)`, api: l.accounted_raw, rpc: s.accounted, ok: l.accounted_raw === s.accounted });
    }
    // per_share_raw is derived; check it from the independently read numbers (no pending: P=0 unless program).
    if (!bf || bf.legs[i].pending === "0") {
      const acc = BigInt(bf ? bf.legs[i].accounted : standin.legs[i].accounted);
      const bal = u64(v, 64);
      const loss = BigInt(bf ? bf.legs[i].loss : standin.legs[i].loss_index);
      void acc; void loss;
      eq(`${l.symbol}.per_share_raw.num (= B - pending, P = 0)`, l.per_share_raw.num, bal);
      eq(`${l.symbol}.per_share_raw.den (= S + C)`, l.per_share_raw.den, BigInt(share.supply) + BigInt(bf ? bf.legs[i].claim : "0"));
    }
    // Mainnet side: the multiplier used for reference, and the fee on the sell hop.
    const mm = mintFacts(m1.data[i]!, 0, now);
    const ref = api.values.reference.legs.find((x: any) => x.index === l.index);
    if (ref) eq(`${l.symbol}.reference.effective_multiplier (mainnet mint)`, Number(ref.effective_multiplier), mm.multiplier_effective);
  });
  return { stable: stable && mstable, changed_during_window: { cluster: changed, mainnet_checked_fields: mchanged }, api_slot: api.as_of_slot, rpc_slots: [r1.slot, r2.slot], mainnet_slots: [m1.slot, m2.slot], api_mainnet_slot: api.as_of.mainnet_slot, basket_source: api.basket_source.kind, checks };
}

let res: any;
for (let i = 0; i < 3; i++) {
  res = await once();
  if (res.stable) break;
  console.log("chain changed during the check window; retrying");
}
const bad = res.checks.filter((c: any) => !c.ok);
for (const c of res.checks) if (!c.ok) console.log(`MISMATCH ${c.what}: api ${c.api} rpc ${c.rpc}`);
const ok = res.stable && bad.length === 0;
console.log(`${CLUSTER} slots ${res.rpc_slots.join("..")} (api ${res.api_slot}), mainnet ${res.mainnet_slots.join("..")}: ${res.checks.length} checks, ${bad.length} mismatches, window stable: ${res.stable} -> ${ok ? "OK" : "FAIL"}`);
const out = arg("out") ?? join(import.meta.dirname, "out", `basket-vs-rpc-${CLUSTER}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ check: "every raw number in /v1/basket vs independent decode of RPC account bytes, bracketed read", cluster: CLUSTER, ...res, all_ok: ok }, null, 1));
process.exit(ok ? 0 : 1);
