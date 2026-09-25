// The holder app's shared state: one connection, one basket read, one wallet, one transaction log,
// used by every route. Logic ported from Agent B's app; every route reads it through useHolder().
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Connection, PublicKey, SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  BasketClient, BasketView, ERRORS, FixtureAmmRouter, TOKEN_2022_ERRORS, planAbortDeposit, planInKindDeposit, planObserve, planRedeem, planSettleClaim, planSettleLegUsdc,
  planUsdcDeposit, math, politeFetch,
} from "@unlisted/sdk";
import type { AppConfig } from "./config";
import { signAll } from "./wallet";
import { Position, EventRow, useBasket, useEvents, usePosition } from "./state";
import { sendSequentialWithRetry } from "./send";
import { HttpValuation, MockValuation, Valuation } from "./valuation/api";
import type { BasketResponse, EventsResponse, QuoteDepositResponse } from "./valuation/types";
import type { ClaimRow, TxRecord } from "./components/Panels";

export function explainError(e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  const logs: string[] = (e as any)?.logs ?? (e instanceof SendTransactionError ? (e as any).transactionLogs ?? [] : []);
  const all = [msg, ...logs].join("\n");
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(all);
  if (m) {
    const code = parseInt(m[1], 16);
    if (ERRORS[code]) return `${ERRORS[code]} (${code}): ${msg.split("\n")[0]}`;
    if (TOKEN_2022_ERRORS[code]) return `Token-2022 ${TOKEN_2022_ERRORS[code]} (0x${m[1]}): ${msg.split("\n")[0]}`;
  }
  if (/User rejected|rejected the request/i.test(all)) return "You declined in the wallet.";
  const anchor = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^\n."]+)/.exec(all);
  if (anchor) return `${anchor[1]} (${anchor[2]}): ${anchor[3]}`;
  const programLine = all.split("\n").find((l) => /Program log: (Error|AnchorError)|failed:/.test(l));
  return programLine ? `${msg.split("\n")[0]} ${programLine.trim()}` : msg.split("\n")[0];
}

type Build = (v: BasketView, owner: PublicKey, blockhash: string) => Promise<VersionedTransaction[]>;

export interface Holder {
  config: AppConfig;
  conn: Connection;
  client: BasketClient;
  valuation: Valuation;
  view: BasketView | null;
  chainError: string | null;
  refresh: () => void;
  owner: PublicKey | null;
  walletName: string | null;
  pos: Position | null;
  sol: bigint | null;
  events: { rows: EventRow[]; reload: () => void };
  api: BasketResponse | null;
  apiErr: string | null;
  apiEvents: EventsResponse | null;
  apiPos: any | null;
  apiPosErr: string | null;
  busy: boolean;
  log: TxRecord[];
  routerReady: string | null;
  usdcRouter: boolean;
  onInKind: (target: bigint, slip: number) => Promise<TxRecord>;
  onUsdc: (usdc: bigint, q: QuoteDepositResponse) => Promise<TxRecord>;
  onRedeem: (shares: bigint, mode: "in_kind" | "usdc") => Promise<TxRecord>;
  onSettle: (c: ClaimRow, usdc?: boolean) => Promise<TxRecord>;
  onAbort: (ticket: string) => Promise<TxRecord>;
  onObserve: (leg: number) => Promise<TxRecord>;
  /** The demo's fixture-issuer control (server route, passcode-gated). */
  issuer: (action: "pause" | "resume", symbol: string, passcode: string) => Promise<TxRecord>;
  /** Test tokens for the connected wallet (server-signed mint authority; the wallet pays fees and rent). */
  faucet: () => Promise<TxRecord>;
}

const Ctx = createContext<Holder | null>(null);

export function useHolder(): Holder {
  const h = useContext(Ctx);
  if (!h) throw new Error("useHolder outside HolderProvider");
  return h;
}

export function HolderProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  // Public RPCs rate-limit per IP: queue and space requests, back off on 429.
  const conn = useMemo(() => new Connection(config.rpcUrl, { commitment: "confirmed", fetch: politeFetch({ concurrency: config.rpcConcurrency, minIntervalMs: config.rpcMinIntervalMs, maxRetries: 30 }) as any, disableRetryOnRateLimit: true }), [config.rpcUrl]);
  const client = useMemo(() => new BasketClient(conn, { programId: config.programId, shareMint: config.shareMint, lookupTable: config.lookupTable ?? undefined }), [conn, config]);
  const valuation: Valuation = useMemo(() => {
    if (config.valuationApiUrl) return new HttpValuation(config.valuationApiUrl);
    if (config.router.kind !== "fixture_amm") return new MockValuation();
    const ammId = config.router.programId;
    // USDC per raw leg unit from the pool's own quote for a 1-USDC buy.
    return new MockValuation(async (v, i) => {
      const r = FixtureAmmRouter.live(conn, ammId, v.basket.usdcMint);
      const q = await r.route({ inputMint: v.basket.usdcMint, outputMint: v.legs[i].mint, amount: 1_000_000n, taker: v.address, destination: v.legs[i].vault, slippageBps: 0 });
      return q.quotedOut > 0n ? 1_000_000 / Number(q.quotedOut) : 0;
    });
  }, [config, conn]);
  const { view, error: chainError, refresh } = useBasket(client, config.refreshMs ?? 8000);
  const { publicKey, wallet } = useWallet();
  const owner = publicKey ?? null;
  const pos = usePosition(conn, client, view, owner);
  const events = useEvents(client, view?.slot);
  const [sol, setSol] = useState<bigint | null>(null);
  const [api, setApi] = useState<BasketResponse | null>(null);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [apiEvents, setApiEvents] = useState<EventsResponse | null>(null);
  const [apiPos, setApiPos] = useState<any | null>(null);
  const [apiPosErr, setApiPosErr] = useState<string | null>(null);
  const lastEvents = useRef(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<TxRecord[]>([]);

  useEffect(() => {
    if (!view) return;
    valuation.basket(view).then((b) => { setApi(b); setApiErr(null); }).catch((e) => setApiErr(String(e?.message ?? e)));
    if (Date.now() - lastEvents.current > 30_000) { lastEvents.current = Date.now(); valuation.events(0).then(setApiEvents).catch(() => {}); }
  }, [view?.slot, valuation]);
  useEffect(() => {
    if (!owner || valuation.isMock) { setApiPos(null); return; }
    valuation.position(owner.toBase58()).then((p) => { setApiPos(p); setApiPosErr(null); }).catch((e) => setApiPosErr(String(e?.message ?? e)));
  }, [owner?.toBase58(), pos?.shares, valuation]);
  useEffect(() => {
    if (!owner) { setSol(null); return; }
    conn.getBalance(owner, "confirmed").then((b) => setSol(BigInt(b))).catch(() => {});
  }, [owner?.toBase58(), view?.slot]);

  /** Records one user action in the session log; the record is returned when it settles. */
  async function track(label: string, work: (rec: TxRecord, update: () => void) => Promise<void>): Promise<TxRecord> {
    setBusy(true);
    const id = `${Date.now()}-${Math.random()}`;
    const rec: TxRecord = { id, label, signatures: [], status: "pending", approvals: 0, at: new Date().toISOString() };
    setLog((l) => [{ ...rec }, ...l]);
    const update = () => setLog((l) => l.map((x) => (x.id === id ? { ...rec, signatures: [...rec.signatures] } : x)));
    try {
      await work(rec, update);
    } catch (e) {
      rec.status = "failed";
      rec.error = explainError(e);
    }
    update();
    setBusy(false);
    refresh();
    events.reload();
    return { ...rec };
  }

  function run(label: string, build: Build): Promise<TxRecord> {
    return track(label, async (rec, update) => {
      if (!owner || !wallet) throw new Error("Connect a wallet first.");
      const fresh = await client.fetchBasket(); // plan against the latest state, not the rendered one
      // Finalized: every RPC node already has it, so a lagging node can't answer "Blockhash not found".
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(config.fastRpc ? "confirmed" : "finalized");
      const txs = await build(fresh, owner, blockhash);
      const signed = await signAll(wallet.adapter, owner, config.cluster, txs); // ONE approval for the flow
      rec.approvals = 1;
      const sent = await sendSequentialWithRetry(conn, signed, (_i, sig) => { rec.signatures.push(sig); update(); },
        { onRetry: (i, a, why) => { rec.retries = [...(rec.retries ?? []), `tx ${i + 1} attempt ${a + 1}: ${why}`]; update(); }, ...sendTuning(lastValidBlockHeight) });
      const failed = sent.find((s) => s.err);
      rec.status = failed || sent.length < signed.length ? "failed" : "ok";
      if (failed) rec.error = `transaction ${failed.signature} failed: ${JSON.stringify(failed.err)}`;
    });
  }

  // Confirmation pacing: fast on a dedicated RPC, and every flow stops the moment its blockhash is dead.
  const sendTuning = (lastValidBlockHeight?: number) => ({ lastValidBlockHeight, pollMs: config.fastRpc ? 800 : 3_000 });

  const router = (v: BasketView) => (config.router.kind === "fixture_amm" ? FixtureAmmRouter.live(conn, config.router.programId, v.basket.usdcMint) : null);

  const value: Holder = {
    config, conn, client, valuation, view, chainError, refresh, owner, walletName: wallet?.adapter.name ?? null, pos, sol, events,
    api, apiErr, apiEvents, apiPos, apiPosErr, busy, log,
    routerReady: config.router.kind === "none"
      ? "USDC deposits need the devnet router (fixture_amm, Agent C), which isn't configured on this cluster yet. In-kind deposits work now."
      : null,
    usdcRouter: config.router.kind === "fixture_amm",
    onInKind: (target, slip) => run("Buy in (deposit in kind)", async (v, o, bh) => planInKindDeposit(v, o, target, slip, bh).txs),
    onUsdc: (usdc, q) => run("Buy with USDC (ticket)", async (v, o, bh) => {
      const r = router(v);
      if (!r) throw new Error("no router on this cluster");
      return (await planUsdcDeposit({ v, owner: o, usdcIn: usdc, split: q.legs.map((l) => BigInt(l.usdc_raw)), router: r, slippageBps: 150, blockhash: bh })).txs;
    }),
    onRedeem: (shares, mode) => run(mode === "in_kind" ? "Redeem in kind" : "Redeem for USDC", async (v, o, bh) =>
      (await planRedeem({ v, owner: o, shares, mode: mode === "in_kind" ? { kind: "InKind" } : { kind: "Usdc", minUsdcOut: 0n }, blockhash: bh,
        existingLegAtas: pos?.legAtaExists ?? v.legs.map(() => false) })).txs),
    onSettle: (c, usdc = false) => run(`Settle ${view?.legs[c.leg].symbol} claim${usdc ? " for USDC" : ""}`, async (v, o, bh) => {
      if (!usdc) return [planSettleClaim({ v, cranker: o, ticket: new PublicKey(c.ticket), owner: o, leg: c.leg, blockhash: bh })];
      const r = router(v);
      if (!r) throw new Error("no router on this cluster");
      const l = v.legs[c.leg];
      const sellAmount = (c.units * math.owned(math.observe(l.state).leg)) / (v.shareSupply + l.state.claimUnits);
      return [(await planSettleLegUsdc({ v, owner: o, ticket: new PublicKey(c.ticket), leg: c.leg, sellAmount, router: r, slippageBps: 150, blockhash: bh })).tx];
    }),
    onAbort: (ticketAddr) => run("Abort deposit and refund", async (v, o, bh) => {
      const ticket = new PublicKey(ticketAddr);
      const t = (await client.depositTickets(o)).find((x) => x.address.equals(ticket));
      if (!t) throw new Error("deposit ticket not found (already closed?)");
      // Every token account the ticket owns, read from chain: the program closes only those it's given.
      const owned = (await client.ticketOwnedTokenAccounts(ticket)).map((a) => a.address);
      return (await planAbortDeposit({ v, owner: o, ticket, t: t.ticket, ticketOwned: owned, router: router(v), slippageBps: 150, blockhash: bh })).txs;
    }),
    onObserve: (leg) => run(`Observe ${view?.legs[leg].symbol}`, async (v, o, bh) => [planObserve({ v, cranker: o, mask: 1 << leg, blockhash: bh })]),
    issuer: (action, symbol, passcode) => track(`Issuer ${action === "pause" ? "pauses" : "resumes"} ${symbol} (devnet fixture)`, async (rec, update) => {
      // The chain is the truth: if the request is lost, read the mint and report what actually happened.
      const want = action === "pause";
      const onChain = async () => {
        const v = await client.fetchBasket();
        return v.legs.find((l) => l.symbol === symbol)?.unavailable.includes("paused") === want;
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 55_000);
        try {
          const res = await fetch("/api/issuer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, symbol, passcode }), signal: ctl.signal });
          const j = await res.json().catch(() => ({}));
          if (j.signature) { rec.signatures.push(j.signature); update(); }
          if (!res.ok) throw Object.assign(new Error(j.error ?? `HTTP ${res.status}`), { http: res.status });
          rec.status = "ok";
          return;
        } catch (e: any) {
          if (e?.http && e.http < 500) throw e; // refused (passcode, input): nothing to retry
          if (await onChain().catch(() => false)) { rec.status = "ok"; return; } // it landed; only the answer was lost
          if (attempt === 1) throw e; // the server is idempotent, so one retry is safe
        } finally {
          clearTimeout(timer);
        }
      }
    }),
    faucet: () => track("Get test tokens", async (rec, update) => {
      if (!owner || !wallet) throw new Error("Connect a wallet first.");
      const res = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: owner.toBase58() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      // Legacy transactions, partly signed by the fixture mint authority; the wallet signs as fee payer.
      const txs = (j.transactions as string[]).map((b) => VersionedTransaction.deserialize(Buffer.from(b, "base64")));
      const signed = await signAll(wallet.adapter, owner, config.cluster, txs);
      rec.approvals = 1;
      const sent = await sendSequentialWithRetry(conn, signed, (_i, sig) => { rec.signatures.push(sig); update(); }, sendTuning(j.lastValidBlockHeight));
      const failed = sent.find((s) => s.err);
      if (failed || sent.length < signed.length) throw new Error(`transaction ${failed?.signature ?? ""} failed: ${JSON.stringify(failed?.err ?? "not sent")}`);
      rec.status = "ok";
    }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

