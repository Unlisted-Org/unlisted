// Re-check every recorded devnet signature: finalized, no error. Writes devnet/verification.json.
import { Connection } from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT } from "../src/env.ts";
const conn = new Connection("https://api.devnet.solana.com", { commitment: "finalized", disableRetryOnRateLimit: false });
const DIR = path.join(ROOT, "tests/program/devnet");
const files = ["deploy.json", "setup.json", "seizure.json", "pause-mid-redemption.json", "fee-change-mid-position.json", "multiplier-change-mid-position.json", "hook-switched-on.json", "frozen-vault.json"];
const out: any = { checkedAt: new Date().toISOString(), files: {} };
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const sigs: string[] = f === "deploy.json" ? [d.deploySignature] : d.steps.filter((s: any) => s.signature).map((s: any) => s.signature);
  const st: any[] = [];
  for (let i = 0; i < sigs.length; i += 100) {
    for (let k = 0; ; k++) {
      try { st.push(...(await conn.getSignatureStatuses(sigs.slice(i, i + 100), { searchTransactionHistory: true })).value); break; }
      catch (e) { if (k > 10) throw e; await new Promise((r) => setTimeout(r, 3000 * (k + 1))); }
    }
  }
  const finalized = st.filter((s) => s && !s.err && s.confirmationStatus === "finalized").length;
  const refusals = f === "deploy.json" ? 0 : d.steps.filter((s: any) => s.refused).length;
  const checks = d.checks ? `${d.checks.filter((c: any) => c.ok).length}/${d.checks.length}` : "-";
  out.files[f] = { signatures: sigs.length, finalizedNoError: finalized, refusalsSimulated: refusals, checksPassed: checks, passed: d.passed };
  console.log(`${f}: ${finalized}/${sigs.length} finalized without error; refusals ${refusals}; checks ${checks}`);
}
fs.writeFileSync(path.join(DIR, "verification.json"), JSON.stringify(out, null, 1));
