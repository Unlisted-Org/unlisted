// Stop the local validator started by setup.ts and delete its ledger (keeps the disk footprint small).
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const LOCAL = join(dirname(fileURLToPath(import.meta.url)), "../.local");
const pidFile = join(LOCAL, "validator.pid");
if (existsSync(pidFile)) {
  try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM"); } catch {}
  rmSync(pidFile);
}
await new Promise((r) => setTimeout(r, 1500));
rmSync(join(LOCAL, "ledger"), { recursive: true, force: true });
console.log("local validator stopped; ledger deleted");
