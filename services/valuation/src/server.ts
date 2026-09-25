// Unlisted valuation API server (spec 03). Plain node:http; JSON out; BigInt serialised as decimal strings.
//   CLUSTER=devnet node src/server.ts         (see src/config.ts for every variable)

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.ts";
import { Valuation } from "./valuation.ts";
import { Watcher } from "./watcher.ts";
import { basketAddress } from "./lib/basket.ts";
import { MUTATION } from "./lib/mutation.ts";

const cfg = loadConfig();
const watcher = new Watcher(cfg.dataPath, cfg.targets);
if (cfg.basket.source === "program" && cfg.basket.idl) {
  watcher.program = { cluster: cfg.cluster, rpc: cfg.rpc, programId: cfg.basket.program!, basket: basketAddress(cfg.basket.program!, cfg.basket.shareMint!), idl: cfg.basket.idl };
}
const v = new Valuation(cfg, watcher);

// /v1/basket is kept warm: recomputed every BASKET_REFRESH_S in the background and served from the
// latest completed computation (its as_of says when). `?fresh=1` computes on demand.
// The latest computation is also saved to disk, so a restarted service answers at once with the last
// good basket (marked `served.from: "cache"` with its age) while a fresh one is computed. A cold
// visitor never waits for the first computation unless there has never been one.
const REFRESH_S = Number(process.env.BASKET_REFRESH_S ?? 30);
const CACHE_FILE = process.env.BASKET_CACHE_FILE ?? join(dirname(cfg.dataPath), `basket-latest-${cfg.cluster}.json`);
let latest: { at: number; body: any; fromDisk?: boolean } | null = null;
if (!process.env.NO_BASKET_CACHE && existsSync(CACHE_FILE)) {
  try { const c = JSON.parse(readFileSync(CACHE_FILE, "utf8")); latest = { at: c.at, body: c.body, fromDisk: true }; console.log(`serving the saved basket from ${new Date(c.at).toISOString()} until a fresh one is computed`); }
  catch (e) { console.error("saved basket unreadable, ignoring", e); }
}
let computing: Promise<unknown> | null = null;
const json = (x: unknown) => JSON.stringify(x, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 1);
const save = (at: number, body: unknown) => {
  if (process.env.NO_BASKET_CACHE) return;
  try { mkdirSync(dirname(CACHE_FILE), { recursive: true }); writeFileSync(`${CACHE_FILE}.tmp`, json({ at, body })); renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE); }
  catch (e) { console.error("could not save basket", e); }
};
const refresh = () => (computing ??= v.getBasket().then((b) => { latest = { at: Date.now(), body: b }; save(latest.at, b); return b; }).finally(() => { computing = null; }));
const served = (from: "live" | "cache") => ({ from, age_s: latest ? Math.round((Date.now() - latest.at) / 1000) : null, refresh_s: REFRESH_S });
const warmBasket = async () => {
  if (!latest) return { ...(await refresh() as any), served: served("live") };
  const stale = latest.fromDisk || Date.now() - latest.at >= 2 * REFRESH_S * 1000;
  if (stale) refresh().catch((e) => console.error("basket refresh", e)); // never make the visitor wait for it
  return { ...latest.body, served: served(stale ? "cache" : "live") };
};
setInterval(() => refresh().catch((e) => console.error("basket refresh", e)), REFRESH_S * 1000);
const firstBasket = refresh().catch((e) => console.error("basket refresh", e));

const routes: [RegExp, (m: RegExpMatchArray, q: URLSearchParams) => Promise<unknown>][] = [
  [/^\/v1\/basket$/, (_m, q) => (q.get("include_builds") ? v.getBasket({ includeBuilds: true, fresh: true }) : q.get("fresh") ? v.getBasket({ fresh: true }) : warmBasket())],
  [/^\/v1\/position\/([1-9A-HJ-NP-Za-km-z]{32,44})$/, (m) => v.position(m[1])],
  [/^\/v1\/quote\/redeem$/, (_m, q) => {
    const mode = (q.get("mode") ?? "in_kind") as "in_kind" | "usdc";
    if (!/^\d+$/.test(q.get("shares") ?? "")) throw Object.assign(new Error("shares (raw u64) required"), { status: 400 });
    if (mode !== "in_kind" && mode !== "usdc") throw Object.assign(new Error("mode must be in_kind or usdc"), { status: 400 });
    return v.quoteRedeem(BigInt(q.get("shares")!), mode);
  }],
  [/^\/v1\/quote\/deposit$/, (_m, q) => {
    if (!/^\d+$/.test(q.get("usdc") ?? "")) throw Object.assign(new Error("usdc (raw, 6 decimals) required"), { status: 400 });
    return v.quoteDeposit(BigInt(q.get("usdc")!), q.get("slippage_bps") ? Number(q.get("slippage_bps")) : undefined);
  }],
  [/^\/v1\/capacity$/, (_m, q) => v.capacity(Number(q.get("max_round_trip_bps") ?? 1000))],
  [/^\/v1\/events$/, async (_m, q) => v.events({ since_slot: Number(q.get("since_slot") ?? 0), since_mainnet_slot: Number(q.get("since_mainnet_slot") ?? 0) })],
  [/^\/v1\/issuer$/, () => v.issuer()],
  [/^\/health$/, async () => ({ ok: true, service: "Unlisted valuation API", mutation: MUTATION || null, cluster: cfg.cluster, basket_source: cfg.basket.source, registry: cfg.registryPath, watcher_last_poll: watcher.lastPoll })],
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("content-type", "application/json");
  if (req.method !== "GET") { res.statusCode = 405; return res.end(json({ error: "GET only" })); }
  for (const [re, h] of routes) {
    const m = url.pathname.match(re);
    if (!m) continue;
    try {
      let body: any = await h(m, url.searchParams);
      if (MUTATION && body && typeof body === "object") body = { MUTATION_ACTIVE: MUTATION, ...body };
      res.statusCode = 200;
      return res.end(json(body));
    } catch (e: any) {
      res.statusCode = e?.status ?? 502;
      return res.end(json({ error: String(e?.message ?? e) }));
    }
  }
  res.statusCode = 404;
  res.end(json({ error: "not found", endpoints: ["/v1/basket", "/v1/position/{owner}", "/v1/quote/redeem?shares=&mode=", "/v1/quote/deposit?usdc=", "/v1/capacity?max_round_trip_bps=", "/v1/events?since_slot=", "/v1/issuer"] }));
});

server.listen(cfg.port, () => console.log(`Unlisted valuation API on :${cfg.port} (cluster ${cfg.cluster}, basket source ${cfg.basket.source})${MUTATION ? ` MUTATION ACTIVE: ${MUTATION}` : ""}`));
// The watcher's history backfill uses the same RPCs; start it after the first basket (or 60 s), so it
// never competes with the first answer.
const poll = () => watcher.pollOnce().catch((e) => console.error("watcher", e));
Promise.race([firstBasket, new Promise((r) => setTimeout(r, 60_000))]).then(() => { poll(); setInterval(poll, cfg.pollS * 1000); });
