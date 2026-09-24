// After a mint-level scenario is reversed, prove on chain that every fixture mint is back in its
// mirror state: not paused, hook program null, default account state initialized, effective multiplier
// equal to the mainnet mint's. Exits 1 otherwise. Appends to fixtures/scenarios/restored-checks.json.
//
//   node scripts/scenarios/verify-restored.ts --cluster devnet --after "<which scenario>"

import { join } from "node:path";
import { existsSync } from "node:fs";
import { extensions, effectiveMultiplier } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, loadRegistry, rpcFor, mainnet, scenarioDir, readJson, writeJson, nowIso } from "../lib/env.ts";

const c = cluster();
const reg = loadRegistry(c);
const [fx, mn] = await Promise.all([rpcFor(c).accounts(reg.legs.map((l: any) => l.mint)), mainnet().accounts(reg.legs.map((l: any) => l.mirror_of))]);
const now = Math.floor(Date.now() / 1000);
const rows = reg.legs.map((l: any, i: number) => {
  const f = fx.values[i].data.parsed.info, x = extensions(f);
  const m = mn.values[i].data.parsed.info;
  const r = {
    symbol: l.symbol, mint: l.mint,
    paused: Boolean(x.pausableConfig?.paused), hook_program: x.transferHook?.programId ?? null, default_state: x.defaultAccountState?.accountState,
    multiplier_effective: effectiveMultiplier(f, now).effective, mainnet_multiplier_effective: effectiveMultiplier(m, now).effective,
    multiplier_pending: effectiveMultiplier(f, now).pending,
  };
  return { ...r, ok: !r.paused && r.hook_program === null && r.default_state === "initialized" && Number(r.multiplier_effective) === Number(r.mainnet_multiplier_effective) && !r.multiplier_pending };
});
const ok = rows.every((r: any) => r.ok);
const path = join(scenarioDir(c), "restored-checks.json");
const file = existsSync(path) ? readJson(path) : { what: "On-chain proof that fixture mints are back in their mirror state after each mint-level scenario", cluster: c, checks: [] };
file.checks.push({ after: arg("after", "?"), at: nowIso(), fixture_slot: fx.slot, mainnet_slot: mn.slot, all_restored: ok, legs: rows });
writeJson(path, file);
for (const r of rows) if (!r.ok) console.log(`NOT RESTORED ${r.symbol}: ${JSON.stringify(r)}`);
console.log(`${ok ? "restored" : "NOT RESTORED"} at ${c} slot ${fx.slot} (after ${arg("after", "?")})`);
process.exit(ok ? 0 : 1);
