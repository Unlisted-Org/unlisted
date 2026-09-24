// Acceptance check (spec 03 §3, as ruled 2026-09-25): a multiplier change on a fixture moves display
// fields only, and only after the effective timestamp. Raw fields and all USD valuation inputs never move.
//
//   CLUSTER=devnet API=http://localhost:8905 node verify/multiplier-display.ts --symbol KALSHI [--value 2] [--in-seconds 90]
//
// Steps: snapshot A (before) -> issuer scenario `multiplier` (real signed transaction, recorded in
// fixtures/scenarios/multiplier-change.json) -> snapshot B (after the tx, before the effective time)
// -> wait -> snapshot C (after the effective time) -> restore the original multiplier (second scenario run).
// Assertions: B display == A display and B shows the change as pending; C effective == new value and
// per_share_ui scales by new/old; every raw field and every sell/reference input amount equal in A, B, C;
// the reference multiplier (mainnet mint) unchanged.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const API = process.env.API ?? "http://localhost:8905";
const CLUSTER = process.env.CLUSTER ?? "devnet";
const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const symbol = arg("symbol", "KALSHI")!;
const value = Number(arg("value", "2"));
const inSeconds = Number(arg("in-seconds", "90"));
const REPO = join(import.meta.dirname, "..", "..", "..");
const get = async () => (await fetch(`${API}/v1/basket?fresh=1`)).json() as Promise<any>;
const leg = (b: any) => b.legs.find((l: any) => l.symbol === symbol);
const RAW = ["balance_raw", "accounted_raw", "pending_raw", "claim_units", "pending_norm", "loss_index"];
const scenario = (v: number, secs: number, note: string) => execFileSync("node", [join(REPO, "scripts/scenarios/issuer.ts"), "multiplier", "--cluster", CLUSTER, "--symbol", symbol, "--value", String(v), "--in-seconds", String(secs), "--note", note], { encoding: "utf8" });

const checks: any[] = [];
const eq = (what: string, a: any, b: any) => checks.push({ what, a: JSON.stringify(a), b: JSON.stringify(b), ok: JSON.stringify(a) === JSON.stringify(b) });
const inputs = (b: any) => ({
  raw: RAW.map((k) => leg(b)[k]), per_share_raw: leg(b).per_share_raw,
  sell_amount: b.values.sell_now.legs.find((x: any) => x.symbol === symbol)?.amount_raw,
  ref_multiplier: b.values.reference.legs.find((x: any) => x.symbol === symbol)?.effective_multiplier,
});

const A = await get();
const old = Number(leg(A).multiplier.effective);
scenario(value, inSeconds, "verify/multiplier-display.ts: change");
const B = await get();
const tsB = Date.now() / 1000;
const eff = leg(B).multiplier.pending?.effective_at ? Date.parse(leg(B).multiplier.pending.effective_at) / 1000 : tsB;
eq("B (before effective time): effective multiplier unchanged", leg(B).multiplier.effective, leg(A).multiplier.effective);
eq("B: per_share_ui unchanged", leg(B).per_share_ui.value, leg(A).per_share_ui.value);
eq("B: pending shows the new multiplier", Number(leg(B).multiplier.pending?.multiplier), value);
eq("B: raw fields and valuation inputs unchanged", inputs(B), inputs(A));
while (Date.now() / 1000 < eff + 3) await new Promise((r) => setTimeout(r, 2000));
const C = await get();
eq("C (after effective time): effective == new value", Number(leg(C).multiplier.effective), value);
eq("C: pending cleared", leg(C).multiplier.pending, null);
const ratio = Number(leg(C).per_share_ui.value) / Number(leg(A).per_share_ui.value);
checks.push({ what: "C: per_share_ui scaled by new/old", a: ratio.toFixed(9), b: (value / old).toFixed(9), ok: Math.abs(ratio - value / old) < 1e-9 });
eq("C: raw fields and valuation inputs unchanged", inputs(C), inputs(A));
eq("C: stored field unchanged (set with a future timestamp)", leg(C).multiplier.stored, leg(A).multiplier.stored);
scenario(old, 5, "verify/multiplier-display.ts: restore");

const ok = checks.every((c) => c.ok);
for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.what}${c.ok ? "" : `: ${c.a} vs ${c.b}`}`);
const out = join(import.meta.dirname, "out", `multiplier-display-${CLUSTER}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ check: "fixture multiplier change moves display fields only, after the effective time", cluster: CLUSTER, symbol, old, value, slots: { A: A.as_of_slot, B: B.as_of_slot, C: C.as_of_slot }, effective_at: new Date(eff * 1000).toISOString(), checks, all_ok: ok }, null, 1));
console.log(`${ok ? "ALL OK" : "FAILED"} -> ${out}`);
process.exit(ok ? 0 : 1);
