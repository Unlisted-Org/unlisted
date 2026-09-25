import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Connection, PublicKey, SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "@wallet-standard/base";
import {
  BasketClient, BasketView, ERRORS, FixtureAmmRouter, TOKEN_2022_ERRORS, planAbortDeposit, planInKindDeposit, planObserve, planRedeem, planSettleClaim, planSettleLegUsdc,
  planUsdcDeposit, sendSequential, math,
  politeFetch,
} from "@unlisted/sdk";
import type { AppConfig } from "./config";
import { Connected, connect, onWalletsChanged, signAll, usableWallets } from "./wallet";
import { useBasket, useEvents, usePosition } from "./state";
import { sendSequentialWithRetry } from "./send";
import { HttpValuation, MockValuation, Valuation } from "./valuation/api";
import type { BasketResponse, EventsResponse, QuoteDepositResponse } from "./valuation/types";
import {
  Banners, BasisStrip, ClaimRow, claimsOf, Guard, IssuerActivity, OpenDepositTickets, ClaimsList, Disclosures, EventsPanel, LegsTable, PricePanel, RedemptionHistory, TxLog, TxRecord, issuerBanners,
} from "./components/Panels";
import { DepositPanel, RedeemPanel } from "./components/Actions";
import * as copy from "./copy";
import { fmtShares, short } from "./format";

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

export function App({ config }: { config: AppConfig }) {
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
  const { view, error, refresh } = useBasket(client, config.refreshMs ?? 8000);
  const [wallets, setWallets] = useState<Wallet[]>(usableWallets());
  const [wallet, setWallet] = useState<Connected | null>(null);
  const pos = usePosition(conn, client, view, wallet?.publicKey ?? null);
  const events = useEvents(client, view?.slot);
  const [api, setApi] = useState<BasketResponse | null>(null);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [apiEvents, setApiEvents] = useState<EventsResponse | null>(null);
  const [apiPos, setApiPos] = useState<any | null>(null);
  const lastEvents = useRef(0);
  const [apiPosErr, setApiPosErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<TxRecord[]>([]);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null); // details tabs: all collapsed by default

  useEffect(() => onWalletsChanged(() => setWallets(usableWallets())), []);
  useEffect(() => {
    if (!view) return;
    valuation.basket(view).then((b) => { setApi(b); setApiErr(null); }).catch((e) => setApiErr(String(e?.message ?? e)));
    if (Date.now() - lastEvents.current > 30_000) { lastEvents.current = Date.now(); valuation.events(0).then(setApiEvents).catch(() => {}); }
  }, [view?.slot, valuation]);
  useEffect(() => {
    if (!wallet || valuation.isMock) { setApiPos(null); return; }
    valuation.position(wallet.publicKey.toBase58()).then((p) => { setApiPos(p); setApiPosErr(null); }).catch((e) => setApiPosErr(String(e?.message ?? e)));
  }, [wallet?.publicKey.toBase58(), pos?.shares, valuation]);

  async function run(label: string, build: (v: BasketView, owner: PublicKey, blockhash: string) => Promise<VersionedTransaction[]>) {
    if (!wallet || !view) return;
    setBusy(true);
    const id = `${Date.now()}-${Math.random()}`;
    const rec: TxRecord = { id, label, signatures: [], status: "pending", approvals: 0, at: new Date().toISOString() };
    setLog((l) => [{ ...rec }, ...l]);
    const update = () => setLog((l) => l.map((x) => (x.id === id ? { ...rec, signatures: [...rec.signatures] } : x)));
    try {
      const fresh = await client.fetchBasket(); // plan against the latest state, not the rendered one
      // Finalized: every RPC node already has it, so a lagging node can't answer "Blockhash not found".
      const { blockhash } = await conn.getLatestBlockhash("finalized");
      const txs = await build(fresh, wallet.publicKey, blockhash);
      const signed = await signAll(wallet, txs); // ONE approval for every transaction of the flow
      rec.approvals = 1;
      const sent = await sendSequentialWithRetry(conn, signed, (_i, sig) => { rec.signatures.push(sig); update(); },
        { onRetry: (i, a, why) => { rec.retries = [...(rec.retries ?? []), `tx ${i + 1} attempt ${a + 1}: ${why}`]; update(); } });
      const failed = sent.find((s) => s.err);
      rec.status = failed || sent.length < signed.length ? "failed" : "ok";
      if (failed) rec.error = `transaction ${failed.signature} failed: ${JSON.stringify(failed.err)}`;
    } catch (e) {
      rec.status = "failed";
      rec.error = explainError(e);
    }
    update();
    setBusy(false);
    refresh();
    events.reload();
  }

  const onInKind = (target: bigint, slip: number) => run("Deposit in kind", async (v, owner, bh) => planInKindDeposit(v, owner, target, slip, bh).txs);
  const router = (v: BasketView) => (config.router.kind === "fixture_amm" ? FixtureAmmRouter.live(conn, config.router.programId, v.basket.usdcMint) : null);
  const onUsdc = (usdc: bigint, q: QuoteDepositResponse) => run("Deposit USDC (ticket)", async (v, owner, bh) => {
    const r = router(v);
    if (!r) throw new Error("no router on this cluster");
    const plan = await planUsdcDeposit({ v, owner, usdcIn: usdc, split: q.legs.map((l) => BigInt(l.usdc_raw)), router: r, slippageBps: 150, blockhash: bh });
    return plan.txs;
  });
  const onRedeem = (shares: bigint, mode: "in_kind" | "usdc") => run(mode === "in_kind" ? "Redeem in kind" : "Redeem for USDC", async (v, owner, bh) => {
    const p = await planRedeem({ v, owner, shares, mode: mode === "in_kind" ? { kind: "InKind" } : { kind: "Usdc", minUsdcOut: 0n }, blockhash: bh,
      existingLegAtas: pos?.legAtaExists ?? v.legs.map(() => false) });
    return p.txs;
  });
  const onSettle = (c: ClaimRow, usdc = false) => run(`Settle ${view?.legs[c.leg].symbol} claim${usdc ? " for USDC" : ""}`, async (v, owner, bh) => {
    if (!usdc) return [planSettleClaim({ v, cranker: owner, ticket: new PublicKey(c.ticket), owner, leg: c.leg, blockhash: bh })];
    const r = router(v);
    if (!r) throw new Error("no router on this cluster");
    const l = v.legs[c.leg];
    const sellAmount = (c.units * math.owned(math.observe(l.state).leg)) / (v.shareSupply + l.state.claimUnits);
    return [(await planSettleLegUsdc({ v, owner, ticket: new PublicKey(c.ticket), leg: c.leg, sellAmount, router: r, slippageBps: 150, blockhash: bh })).tx];
  });

  const onAbort = (ticketAddr: string) => run("Abort deposit and refund", async (v, owner, bh) => {
    const ticket = new PublicKey(ticketAddr);
    const t = (await client!.depositTickets(owner)).find((x) => x.address.equals(ticket));
    if (!t) throw new Error("deposit ticket not found (already closed?)");
    // Every token account the ticket owns, read from chain: the program closes only those it's given.
    const owned = (await client!.ticketOwnedTokenAccounts(ticket)).map((a) => a.address);
    return (await planAbortDeposit({ v, owner, ticket, t: t.ticket, ticketOwned: owned, router: router(v), slippageBps: 150, blockhash: bh })).txs;
  });

  const onObserve = (leg: number) => run(`Observe ${view?.legs[leg].symbol}`, async (v, owner, bh) => [planObserve({ v, cranker: owner, mask: 1 << leg, blockhash: bh })]);

  const routerReady = config.router.kind === "none"
    ? "USDC deposits need the devnet router (fixture_amm, Agent C), which isn't configured on this cluster yet. In-kind deposits work now."
    : null;

  return (
    <div className="page">
      <header>
        <div>
          <h1>Your Unlisted position</h1>
          <div className="headline">{copy.HEADLINE}</div>
        </div>
        <div className="wallet">
          {wallet ? (
            <span data-testid="wallet-connected">{wallet.wallet.name} · <span className="mono" data-testid="wallet-address">{wallet.publicKey.toBase58()}</span></span>
          ) : wallets.length === 0 ? (
            <span className="muted">No Wallet Standard wallet found.</span>
          ) : (
            wallets.map((w) => (
              <button key={w.name} onClick={async () => { try { setWallet(await connect(w, config.cluster)); setConnectErr(null); } catch (e) { setConnectErr(explainError(e)); } }} data-testid={`connect-${w.name}`}>
                Connect {w.name}
              </button>
            ))
          )}
        </div>
      </header>
      {connectErr && <div className="banner alert" data-testid="connect-error">{connectErr}</div>}
      <BasisStrip clusterLabel={config.clusterLabel} basis={api?.pricing_basis.text ?? null} mock={valuation.isMock ? (api?.mock ?? "MOCK valuation") : null} slot={view?.slot ?? null} />
      {error && <div className="banner alert" data-testid="chain-error">Can't read the basket: {error}</div>}
      {!view ? <p className="muted">Reading the basket from {config.rpcUrl}…</p> : (
        <>
          <div id="events-banners"><Banners banners={issuerBanners(view, events.rows, apiEvents)} /></div>
          <div id="overview" className="two">
            <Guard name="Price panel"><PricePanel api={api} error={apiErr} /></Guard>
            <PositionCard wallet={!!wallet} pos={pos} apiPos={apiPos} apiPosErr={apiPosErr} isMock={valuation.isMock}
              openClaims={claimsOf(pos).length} openTickets={pos?.deposits.length ?? 0} onShowClaims={() => setTab("claims")} />
          </div>
          <div className="two">
            <div id="deposit"><DepositPanel v={view} pos={pos} busy={busy} routerReady={routerReady} quoteDeposit={(u) => valuation.quoteDeposit(view, u)} onInKind={onInKind} onUsdc={onUsdc} /></div>
            <div id="redeem"><RedeemPanel v={view} pos={pos} busy={busy} usdcReady={config.router.kind === "none" ? "USDC redemption settles through the devnet router, not configured on this cluster yet." : null} onRedeem={onRedeem}
              quoteRedeem={valuation.isMock ? null : (s, m) => valuation.quoteRedeem(view, s, m)} /></div>
          </div>
          <TxLog log={log} explorer={config.explorerTx} latestOnly />
          <Details tab={tab} setTab={setTab} tabs={[
            { id: "legs", label: "Seven legs", body: <LegsTable v={view} pos={pos} api={api} onObserve={wallet ? onObserve : undefined} busy={busy} /> },
            { id: "claims", label: `Claims${claimsOf(pos).length ? ` (${claimsOf(pos).length})` : ""}`, body: (
              <div className="page">
                <OpenDepositTickets v={view} pos={pos} onAbort={onAbort} busy={busy} />
                <ClaimsList v={view} pos={pos} onSettle={onSettle} busy={busy} usdcRouter={config.router.kind === "fixture_amm"} rows={events.rows} />
                <RedemptionHistory v={view} pos={pos} />
              </div>) },
            { id: "activity", label: "Activity", body: <div className="page"><TxLog log={log} explorer={config.explorerTx} /><EventsPanel v={view} rows={events.rows} /></div> },
            { id: "issuer", label: "Issuer events", body: <Guard name="Issuer activity"><IssuerActivity api={apiEvents} isMock={valuation.isMock} /></Guard> },
            { id: "about", label: "How it works and disclosures", body: (
              <div className="page">
                <section className="intro">
                  <p>{copy.ISSUER_POWERS}</p>
                  <ul>{copy.WHAT_THIS_BASKET_DOES.map((t) => <li key={t}>{t}</li>)}</ul>
                  <p><b>{copy.NOT_PROTECTION}</b></p>
                </section>
                <Disclosures upgradeAuthority={config.upgradeAuthority} authority={short(view.basket.authority)} />
              </div>) },
          ]} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- position card and details tabs

function PositionCard(p: { wallet: boolean; pos: import("./state").Position | null; apiPos: any; apiPosErr: string | null; isMock: boolean;
  openClaims: number; openTickets: number; onShowClaims: () => void }) {
  if (!p.wallet) return (
    <section data-testid="position">
      <h2>Your position</h2>
      <p className="muted">Connect a wallet to see what you own. Everything else on this page reads the basket without one.</p>
    </section>
  );
  const pos = p.pos;
  const usd = p.apiPos?.values?.sell_now?.usd;
  return (
    <section data-testid="position">
      <h2>Your position</h2>
      {!pos ? <p className="muted">Reading your balances…</p> : (
        <>
          <div className="big-line"><span className="mono" data-testid="position-shares-summary" data-raw={pos.shares.toString()}>{fmtShares(pos.shares)}</span> shares</div>
          {pos.shares > 0n && !p.isMock && (
            <div className="muted" data-testid="position-value">
              {usd != null ? <>Worth <b className="mono">{fmtUsdShort(usd)}</b> if you redeemed now.</> : p.apiPosErr ? `Value unavailable: ${p.apiPosErr}` : "Valuing…"}
            </div>
          )}
          {p.openClaims > 0 && (
            <div className="banner warn" data-testid="position-open-claims">
              <b>{p.openClaims} open claim{p.openClaims > 1 ? "s" : ""}</b>
              <div>A paused or unavailable leg you're still owed. <button className="linklike" onClick={p.onShowClaims} data-testid="show-claims">View claims</button></div>
            </div>
          )}
          {p.openTickets > 0 && <div className="muted">{p.openTickets} unfinished USDC deposit ticket(s), under Claims.</div>}
          {pos.shares > 0n && !p.isMock && (
            <details><summary>Your shares, valued three ways</summary>
              <Guard name="Position value"><PricePanel api={p.apiPos} error={p.apiPosErr} testid="position-price-panel" title={`Your ${fmtShares(pos.shares)} shares, valued at your size`} /></Guard>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function fmtUsdShort(v: string | number) {
  const n = Number(v);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function Details({ tab, setTab, tabs }: { tab: string | null; setTab: (t: string | null) => void; tabs: { id: string; label: string; body: ReactNode }[] }) {
  return (
    <section id="details" className="details" data-testid="details">
      <h2>Details</h2>
      <div role="tablist" aria-label="Details" className="tabs">
        {tabs.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className={tab === t.id ? "on" : ""}
            onClick={() => setTab(tab === t.id ? null : t.id)} data-testid={`details-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === null && <p className="muted" data-testid="details-collapsed">Pick a tab to open it. The figures behind every number above are here.</p>}
      {tabs.map((t) => (
        // Kept mounted when hidden, so nothing is lost; only one is shown at a time.
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id} data-testid={`details-panel-${t.id}`}>
          {t.body}
        </div>
      ))}
    </section>
  );
}
