// Valuation API server (spec 03). Plain node:http; JSON out; BigInt serialised as decimal strings.
//   CLUSTER=devnet node src/server.ts         (see src/config.ts for every variable)

import { createServer } from "node:http";
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
let latest: { at: number; body: unknown } | null = null;
let computing: Promise<unknown> | null = null;
const refresh = () => (computing ??= v.getBasket().then((b) => { latest = { at: Date.now(), body: b }; return b; }).finally(() => { computing = null; }));
const warmBasket = async () => (latest && Date.now() - latest.at < 2 * Number(process.env.BASKET_REFRESH_S ?? 30) * 1000 ? latest.body : refresh());
setInterval(() => refresh().catch((e) => console.error("basket refresh", e)), Number(process.env.BASKET_REFRESH_S ?? 30) * 1000);
refresh().catch((e) => console.error("basket refresh", e));

const json = (x: unknown) => JSON.stringify(x, (_k, val) => (typeof val === "bigint" ? val.toString() : val), 1);

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
  [/^\/health$/, async () => ({ ok: true, mutation: MUTATION || null, cluster: cfg.cluster, basket_source: cfg.basket.source, registry: cfg.registryPath, watcher_last_poll: watcher.lastPoll })],
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

server.listen(cfg.port, () => console.log(`valuation API on :${cfg.port} (cluster ${cfg.cluster}, basket source ${cfg.basket.source})${MUTATION ? ` MUTATION ACTIVE: ${MUTATION}` : ""}`));
const poll = () => watcher.pollOnce().catch((e) => console.error("watcher", e));
poll();
setInterval(poll, cfg.pollS * 1000);
