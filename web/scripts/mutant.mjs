#!/usr/bin/env node
// Run a command against a deliberately broken version of one file, then restore the file EXACTLY.
//
//   node scripts/mutant.mjs --file <path> --from <text|@file> --to <text|@file> -- <command...>
//
// - The mutant is refused unless --from occurs exactly once in the file (no ambiguous edits).
// - The original bytes are kept in memory and written back when the command ends, fails, or the
//   tool is interrupted (SIGINT/SIGTERM); then the file's sha256 is compared with the original.
// - Exit 0: the command FAILED (mutant killed). Exit 1: the command passed (mutant SURVIVED: a gap).
//   Exit 2: mutant refused (not applied). Exit 3: the restore could not be verified.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 && i < (sep < 0 ? argv.length : sep) ? argv[i + 1] : undefined; };
const text = (v) => (v?.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v);
const file = opt("--file"), from = text(opt("--from")), to = text(opt("--to"));
const cmd = sep >= 0 ? argv.slice(sep + 1) : [];
if (!file || from === undefined || to === undefined || !cmd.length) {
  console.error("usage: mutant.mjs --file <path> --from <text|@file> --to <text|@file> -- <command...>");
  process.exit(2);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const original = readFileSync(file);
const before = sha(original);
const src = original.toString("utf8");
const count = src.split(from).length - 1;
if (count !== 1) {
  console.error(`mutant refused: --from occurs ${count} times in ${file} (must be exactly once); file not touched`);
  process.exit(2);
}

// A copy on disk too: if this process is killed outright (SIGKILL), `cp <file>.mutant-backup <file>` recovers.
const backup = `${file}.mutant-backup`;
writeFileSync(backup, original);
let restored = false;
let child = null;
function restore() {
  if (restored) return;
  writeFileSync(file, original);
  restored = true;
  try { unlinkSync(backup); } catch {}
  const after = sha(readFileSync(file));
  if (after !== before) {
    console.error(`RESTORE FAILED: ${file} sha256 ${after} != original ${before}`);
    process.exit(3);
  }
  console.error(`restored ${file}; sha256 identical to the original (${before.slice(0, 16)}…)`);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { child?.kill("SIGTERM"); restore(); console.error("interrupted: file restored"); process.exit(130); });
process.on("exit", () => restore());

writeFileSync(file, src.replace(from, to));
console.error(`mutant applied to ${file}; running: ${cmd.join(" ")}`);
child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", shell: false });
child.on("exit", (status, signal) => {
  restore();
  if (status === 0) {
    console.error("mutant SURVIVED: the command passed against the broken version");
    process.exit(1);
  }
  console.error(`mutant killed: the command failed (exit ${status ?? signal})`);
  process.exit(0);
});
