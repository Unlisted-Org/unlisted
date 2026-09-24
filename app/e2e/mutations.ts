// Mutation checks: the e2e must FAIL when the code it guards is deliberately broken.
//   E2E_ENV=devnet|local npx tsx e2e/mutations.ts [--only <id>]
// Each mutant edits one source line (the SDK is consumed from source by the app), runs the flow e2e,
// restores the file, and is recorded as killed (e2e failed) or SURVIVED (e2e passed: a gap in the checks).
// Results go to e2e/runs/<date>-<cluster>-mutations.json. The flow's own cleanup resumes a paused mint.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const MUTANTS = [
  {
    id: "redeem-rounds-up",
    what: "SDK redemption payout rounds up one unit (floor(s x owned / (S + C)) + 1)",
    file: "sdk/src/math.ts",
    from: "    const gross = (s * owned(leg)) / (supply + leg.claimUnits);\n    const fee = transferFee(gross, fees[i] ?? null);\n    return { action: \"pay\", gross, fee, net: gross - fee } as const;",
    to: "    const gross = (s * owned(leg)) / (supply + leg.claimUnits) + 1n;\n    const fee = transferFee(gross, fees[i] ?? null);\n    return { action: \"pay\", gross, fee, net: gross - fee } as const;",
  },
  {
    id: "ignore-pause",
    what: "App ignores the mint's pause flag (a paused leg is shown as available)",
    file: "sdk/src/token2022.ts",
    from: "  if (mint.paused) reasons.push(\"paused\");",
    to: "  if (false && mint.paused) reasons.push(\"paused\");",
  },
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const cluster = (process.env.E2E_ENV ?? "local") === "devnet" ? "devnet" : "localnet";
const results: any[] = [];
for (const m of MUTANTS.filter((x) => !only || x.id === only)) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(m.from)) throw new Error(`${m.id}: target text not found in ${m.file}`);
  const startedAt = new Date().toISOString();
  let out = "";
  let passed = false;
  writeFileSync(path, original.replace(m.from, m.to));
  try {
    out = execFileSync("npx", ["playwright", "test", "flow", "--timeout", "1500000"], {
      cwd: resolve(HERE, ".."), encoding: "utf8", env: { ...process.env, E2E_MUTATION: m.id }, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
    });
    passed = true;
  } catch (e: any) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  } finally {
    writeFileSync(path, original);
  }
  const clean = out.replace(/\u001b\[[0-9;]*m/g, "");
  const failure = clean.split("\n").filter((l) => /Error:|Expected|Received|at .*flow\.spec\.ts:\d+/.test(l)).slice(0, 8).map((l) => l.trim());
  const r = { id: m.id, what: m.what, file: m.file, startedAt, finishedAt: new Date().toISOString(), result: passed ? "SURVIVED" : "killed", failure, runFile: /run file: (\S+)/.exec(clean)?.[1] ?? null };
  results.push(r);
  console.log(`${m.id}: ${r.result}${failure.length ? `\n  ${failure.join("\n  ")}` : ""}`);
}
const file = join(HERE, "runs", `${new Date().toISOString().slice(0, 10)}-${cluster}-mutations.json`);
const prior = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).runs ?? [] : [];
writeFileSync(file, JSON.stringify({ what: "Mutation checks: each mutant must make the flow e2e fail", runs: [...prior, ...results] }, null, 2));
console.log(`mutation results: ${file}`);
if (results.some((r) => r.result === "SURVIVED")) process.exit(1);
