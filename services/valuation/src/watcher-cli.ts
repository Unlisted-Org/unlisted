// Run the issuer-change watcher once (or forever with --loop) and print new events.
//   CLUSTER=devnet node src/watcher-cli.ts [--loop]

import { loadConfig } from "./config.ts";
import { Watcher } from "./watcher.ts";

const cfg = loadConfig();
const w = new Watcher(cfg.dataPath, cfg.targets);
const seen = new Set(w.store.events.map((e) => e.id));
do {
  await w.pollOnce();
  for (const e of w.events().reverse()) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    console.log(`${e.block_time_iso ?? "?"} ${e.cluster} ${e.type} ${e.symbol ?? ""} slot ${e.slot} ${e.signature ?? "(state diff)"} before=${JSON.stringify(e.before ?? null)} after=${JSON.stringify(e.after ?? e.data ?? null)}`);
  }
  if (w.errors.length) console.error(w.errors.join("\n"));
  if (process.argv.includes("--loop")) await new Promise((r) => setTimeout(r, cfg.pollS * 1000));
} while (process.argv.includes("--loop"));
