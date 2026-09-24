import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "@wallet-standard/base";
import {
  BasketClient, BasketView, ERRORS, FixtureAmmRouter, TOKEN_2022_ERRORS, planInKindDeposit, planObserve, planRedeem, planSettleClaim, planSettleLegUsdc,
  planUsdcDeposit, sendSequential, math,
  politeFetch,
} from "@unlisted/sdk";
import type { AppConfig } from "./config";
import { Connected, connect, onWalletsChanged, signAll, usableWallets } from "./wallet";
import { useBasket, useEvents, usePosition } from "./state";
import { HttpValuation, MockValuation, Valuation } from "./valuation/api";
import type { BasketResponse, EventsResponse, QuoteDepositResponse } from "./valuation/types";
import {
  Banners, BasisStrip, ClaimRow, Guard, IssuerActivity, ClaimsList, Disclosures, EventsPanel, LegsTable, PricePanel, RedemptionHistory, TxLog, TxRecord, issuerBanners,
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
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const txs = await build(fresh, wallet.publicKey, blockhash);
      const signed = await signAll(wallet, txs); // ONE approval for every transaction of the flow
      rec.approvals = 1;
      const sent = await sendSequential(conn, signed, (_i, sig) => { rec.signatures.push(sig); update(); });
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

  const onObserve = (leg: number) => run(`Observe ${view?.legs[leg].symbol}`, async (v, owner, bh) => [planObserve({ v, cranker: owner, mask: 1 << leg, blockhash: bh })]);

  const routerReady = config.router.kind === "none"
    ? "USDC deposits need the devnet router (fixture_amm, Agent C), which isn't configured on this cluster yet. In-kind deposits work now."
    : null;

  return (
    <div className="page">
      <header>
        <div>
          <h1>Unlisted basket</h1>
          <div className="headline">{copy.HEADLINE}</div>
        </div>
        <div className="wallet">
          {wallet ? (
            <span data-testid="wallet-connected">{wallet.wallet.name} · <span className="mono" data-testid="wallet-address">{wallet.publicKey.toBase58()}</span></span>
          ) : wallets.length === 0 ? (
            <span className="muted">No Wallet Standard wallet found.</span>
          ) : (
            wallets.map((w) => (
              <button key={w.name} onClick={async () => { try { setWallet(await connect(w, config.cluster)); } catch (e) { alert(explainError(e)); } }} data-testid={`connect-${w.name}`}>
                Connect {w.name}
              </button>
            ))
          )}
        </div>
      </header>
      <BasisStrip clusterLabel={config.clusterLabel} basis={api?.pricing_basis.text ?? null} mock={valuation.isMock ? (api?.mock ?? "MOCK valuation") : null} slot={view?.slot ?? null} />
      {error && <div className="banner alert" data-testid="chain-error">Can't read the basket: {error}</div>}
      {!view ? <p className="muted">Reading the basket from {config.rpcUrl}…</p> : (
        <>
          <Banners banners={issuerBanners(view, events.rows, apiEvents)} />
          <section className="intro">
            <p>{copy.ISSUER_POWERS}</p>
            <ul>{copy.WHAT_THIS_BASKET_DOES.map((t) => <li key={t}>{t}</li>)}</ul>
            <p><b>{copy.NOT_PROTECTION}</b></p>
          </section>
          <Guard name="Price panel"><PricePanel api={api} error={apiErr} /></Guard>
          {wallet && !valuation.isMock && pos && pos.shares > 0n && (
            <Guard name="Position value"><PricePanel api={apiPos} error={apiPosErr} testid="position-price-panel"
              title={`Your ${fmtShares(pos.shares)} shares, valued at your size: three sources`} /></Guard>
          )}
          <LegsTable v={view} pos={pos} api={api} onObserve={wallet ? onObserve : undefined} busy={busy} />
          <div className="two">
            <DepositPanel v={view} pos={pos} busy={busy} routerReady={routerReady} quoteDeposit={(u) => valuation.quoteDeposit(view, u)} onInKind={onInKind} onUsdc={onUsdc} />
            <RedeemPanel v={view} pos={pos} busy={busy} usdcReady={config.router.kind === "none" ? "USDC redemption settles through the devnet router, not configured on this cluster yet." : null} onRedeem={onRedeem}
              quoteRedeem={valuation.isMock ? null : (s, m) => valuation.quoteRedeem(view, s, m)} />
          </div>
          <ClaimsList v={view} pos={pos} onSettle={onSettle} busy={busy} usdcRouter={config.router.kind === "fixture_amm"} rows={events.rows} />
          <RedemptionHistory v={view} pos={pos} />
          <TxLog log={log} explorer={config.explorerTx} />
          <EventsPanel v={view} rows={events.rows} />
          <Guard name="Issuer activity"><IssuerActivity api={apiEvents} isMock={valuation.isMock} /></Guard>
          <Disclosures upgradeAuthority={config.upgradeAuthority} authority={short(view.basket.authority)} />
        </>
      )}
    </div>
  );
}
