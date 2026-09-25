import { useEffect, useMemo, useState } from "react";
import { BasketView, math, planInKindDeposit, TOKEN_2022_PROGRAM_ID, transferFee } from "@unlisted/sdk";
import type { Position } from "../state";
import type { QuoteDepositResponse, QuoteRedeemResponse } from "../valuation/types";
import { fmtBps, fmtRaw, fmtShares, fmtUsd, fmtUsdc, parseUnits } from "../format";
import * as copy from "../copy";

function CostBox({ v }: { v: BasketView }) {
  const now = v.legs.map((l) => l.feeNow?.bps ?? 0);
  const pending = v.legs.map((l) => l.feePending?.bps ?? null);
  const same = (xs: (number | null)[]) => xs.every((x) => x === xs[0]);
  const rt = (b: number) => (1 - (1 - b / 10_000) ** 2) * 100;
  return (
    <div className="cost" data-testid="cost-box">
      <b>What this costs.</b> {copy.COST_PLAIN}
      <ul>
        <li data-testid="cost-fee-now">Transfer fee now, per leg per transfer: {same(now) ? fmtBps(now[0]) : v.legs.map((l, i) => `${l.symbol} ${now[i]} bps`).join(", ")}. Round trip from fees alone: {rt(Math.max(...now)).toFixed(2)}%.</li>
        {pending.some((p) => p != null) && (
          <li data-testid="cost-fee-pending"><b>Scheduled:</b> {same(pending) ? `${fmtBps(pending[0]!)} from epoch ${v.legs[0].feePending!.epoch}` : v.legs.filter((l) => l.feePending).map((l) => `${l.symbol} ${l.feePending!.bps} bps`).join(", ")} (current epoch {String(v.epoch)}). Round trip from fees alone: {rt(Math.max(...pending.map((p) => p ?? 0))).toFixed(2)}%, before spread.</li>
        )}
        <li>Buying the seven tokens yourself pays the same fee on the way in; the basket adds the vault hop's fee on the way out. The basket is not a cheaper way in.</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- deposit

export function DepositPanel(p: {
  v: BasketView; pos: Position | null; busy: boolean; routerReady: string | null; quoteDeposit: (usdc: bigint) => Promise<QuoteDepositResponse>;
  onInKind: (targetShares: bigint, slippageBps: number) => void; onUsdc: (usdc: bigint, q: QuoteDepositResponse) => void;
}) {
  const { v, pos } = p;
  const [tab, setTab] = useState<"usdc" | "inkind">("inkind");
  const [shares, setShares] = useState("0.01");
  const [usdc, setUsdc] = useState("10");
  const [slip, setSlip] = useState(100);
  const [quote, setQuote] = useState<QuoteDepositResponse | null>(null);
  const unavailable = v.legs.filter((l) => l.unavailable.length);
  const refused = unavailable.length > 0 ? `Deposits are refused while ${unavailable.map((l) => l.symbol).join(", ")} ${unavailable.length > 1 ? "are" : "is"} unavailable.` : !v.basket.depositsEnabled ? "New deposits are stopped by the basket authority." : null;

  const plan = useMemo(() => {
    if (!pos || tab !== "inkind") return null;
    try {
      const t = parseUnits(shares, 9);
      if (t <= 0n) return null;
      return planInKindDeposit(v, pos.owner, t, slip, "11111111111111111111111111111111");
    } catch (e: any) { return { error: String(e?.message ?? e) } as const; }
  }, [v, pos, shares, slip, tab]);

  // The service's quote can take tens of seconds (live Jupiter quotes), so it is keyed on the input
  // only and refreshed every 60 s, not on every chain read.
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (tab !== "usdc") return;
    let live = true;
    let u = 0n;
    try { u = parseUnits(usdc, 6); } catch { setQuote(null); return; }
    if (u <= 0n) return;
    const t = setTimeout(() => p.quoteDeposit(u).then((q: any) => {
      if (!live) return;
      if (q?.error) { setQuoteErr(String(q.error)); setQuote(null); } else { setQuote(q); setQuoteErr(null); }
    }).catch((e) => live && setQuoteErr(String(e?.message ?? e))), 500);
    return () => { live = false; clearTimeout(t); };
  }, [tab, usdc, tick]);

  return (
    <section data-testid="deposit">
      <h2>Buy</h2>
      <p className="muted">Deposit the seven tokens, or USDC, and receive Unlisted shares.</p>
      <div className="tabs">
        <button className={tab === "inkind" ? "on" : ""} onClick={() => setTab("inkind")} data-testid="tab-inkind">In kind (you hold the seven tokens)</button>
        <button className={tab === "usdc" ? "on" : ""} onClick={() => setTab("usdc")} data-testid="tab-usdc">USDC (deposit ticket)</button>
      </div>
      {refused && <div className="banner alert" data-testid="deposit-refused">{refused}</div>}
      {tab === "inkind" ? (
        <div>
          <label>Shares to mint <input value={shares} onChange={(e) => setShares(e.target.value)} data-testid="inkind-shares" /></label>
          <label>Slippage tolerance (bps) <input type="number" value={slip} onChange={(e) => setSlip(Number(e.target.value))} /></label>
          <p className="muted">{copy.IN_KIND_RESIDUAL}</p>
          {plan && "error" in plan && <div className="warnline">{plan.error}</div>}
          {plan && !("error" in plan) && pos && (
            <table data-testid="inkind-plan">
              <thead><tr><th>Leg</th><th>You send</th><th>Issuer fee withheld</th><th>Vault receives</th><th>Your balance</th></tr></thead>
              <tbody>
                {v.legs.map((l, i) => (
                  <tr key={i} className={pos.legBalances[i] < plan.gross[i] ? "unavail" : ""}>
                    <td>{l.symbol}</td><td data-testid={`inkind-gross-${l.symbol}`}>{fmtRaw(plan.gross[i])}</td><td>{fmtRaw(plan.fees[i])}</td>
                    <td>{fmtRaw(plan.netDeltas[i])}</td><td>{fmtRaw(pos.legBalances[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {plan && !("error" in plan) && <p>Mints <b data-testid="inkind-expected-shares" data-raw={plan.shares.toString()}>{fmtShares(plan.shares)}</b> shares at this slot; fails if fewer than {fmtShares(plan.minShares)}. One transaction, one wallet approval.</p>}
          <button disabled={!pos || p.busy || !!refused || !plan || "error" in plan || pos.legBalances.some((b, i) => b < (plan as any).gross[i])}
            onClick={() => p.onInKind(parseUnits(shares, 9), slip)} data-testid="inkind-submit">Deposit in kind</button>
          {pos && plan && !("error" in plan) && pos.legBalances.some((b, i) => b < plan.gross[i]) && <div className="warnline">Your wallet doesn't hold enough of every leg for this size.</div>}
        </div>
      ) : (
        <div>
          <label>USDC <input value={usdc} onChange={(e) => setUsdc(e.target.value)} data-testid="usdc-amount" /></label>
          {p.routerReady && <div className="banner warn" data-testid="router-unavailable">{p.routerReady}</div>}
          {!quote && !quoteErr && <p className="muted">Getting the deposit split…</p>}
          {quoteErr && <div className="warnline" data-testid="usdc-quote-error">Deposit quote unavailable: {quoteErr}</div>}
          {quote && (
            <table data-testid="usdc-quote">
              <thead><tr><th>Leg</th><th>USDC slice</th><th>Route</th></tr></thead>
              <tbody>{quote.legs.map((l) => <tr key={l.index}><td>{v.legs[l.index]?.symbol}</td><td>{fmtUsdc(BigInt(l.usdc_raw))}</td><td>{typeof l.route === "string" ? l.route : (l.route as any)?.router ?? "—"}</td></tr>)}</tbody>
            </table>
          )}
          <p className="muted">
            The USDC is escrowed in a ticket, each leg is bought straight into its vault, and shares are minted when all seven have landed.
            That takes more than one transaction (the SDK packs them by size; two in every recorded devnet run); your wallet approves them all at once. If a leg can't land before the ticket expires, the rest is unwound and refunded.
          </p>
          <button disabled={!pos || p.busy || !!refused || !!p.routerReady || !quote} onClick={() => quote && p.onUsdc(parseUnits(usdc, 6), quote)} data-testid="usdc-submit">Deposit USDC</button>
        </div>
      )}
      {/* Cost stays on the buy box, stated plainly, but after the action rather than before it. */}
      <CostBox v={v} />
    </section>
  );
}

// ---------------------------------------------------------------- redeem

export function RedeemPanel(p: { v: BasketView; pos: Position | null; busy: boolean; usdcReady: string | null; onRedeem: (shares: bigint, mode: "in_kind" | "usdc") => void;
  quoteRedeem: ((shares: bigint, mode: "in_kind" | "usdc") => Promise<QuoteRedeemResponse>) | null }) {
  const { v, pos } = p;
  const [amount, setAmount] = useState("0.001");
  const [mode, setMode] = useState<"in_kind" | "usdc">("in_kind");
  const preview = useMemo(() => {
    try {
      const s = parseUnits(amount, 9);
      if (s <= 0n) return null;
      return { s, out: math.redeemInKind(v.legs.map((l) => l.state), v.shareSupply, s, v.legs.map((l) => l.feeNow)) };
    } catch (e: any) { return { error: String(e?.message ?? e) } as const; }
  }, [v, amount]);
  // USD per leg from the valuation API (spec 03 /v1/quote/redeem); raw amounts above come from the chain.
  const [usd, setUsd] = useState<Record<number, string>>({});
  useEffect(() => {
    setUsd({});
    if (!p.quoteRedeem || !preview || "error" in preview) return;
    let live = true;
    const t = setTimeout(() => p.quoteRedeem!(preview.s, mode).then((q) => {
      if (!live) return;
      const m: Record<number, string> = {};
      for (const l of q.legs as any[]) if (l.sell_now_usd != null) m[l.index] = String(l.sell_now_usd);
      setUsd(m);
    }).catch(() => {}), 600);
    return () => { live = false; clearTimeout(t); };
  }, [preview && !("error" in preview) ? preview.s : 0n, mode, v.slot]);
  return (
    <section data-testid="redeem">
      <h2>Sell</h2>
      <p className="muted">Redemption never fails because a leg is unavailable. Every available leg pays now; each unavailable leg becomes a claim.</p>
      <label>Shares <input value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="redeem-shares" /></label>
      {pos && <span className="muted"> You hold <span data-testid="position-shares" data-raw={pos.shares.toString()}>{fmtShares(pos.shares)}</span> shares.</span>}
      <div className="tabs">
        <button className={mode === "in_kind" ? "on" : ""} onClick={() => setMode("in_kind")}>In kind</button>
        <button className={mode === "usdc" ? "on" : ""} onClick={() => setMode("usdc")}>USDC</button>
      </div>
      {mode === "usdc" && <p className="muted">In USDC mode every leg becomes a pending-sale claim, sold later for its pro-rata amount at that time; if no route works it settles in kind.</p>}
      {preview && "error" in preview && <div className="warnline">{preview.error}</div>}
      {preview && !("error" in preview) && (
        <table data-testid="redeem-preview">
          <thead><tr><th>Leg</th><th>Now</th><th>Gross from vault</th><th>Issuer fee</th><th>You receive</th>{p.quoteRedeem && <th>If sold now (API)</th>}</tr></thead>
          <tbody>
            {preview.out.map((o, i) => (
              <tr key={i} data-testid={`redeem-preview-${v.legs[i].symbol}`} className={o.action === "claim" ? "unavail" : ""}>
                <td>{v.legs[i].symbol}</td>
                {o.action === "pay" && mode === "in_kind" ? (<><td>paid now</td><td>{fmtRaw(o.gross)}</td><td>{fmtRaw(o.fee)}</td><td data-testid={`redeem-net-${v.legs[i].symbol}`} data-raw={o.net.toString()}>{fmtRaw(o.net)}</td></>)
                  : o.action === "claim" ? (<><td data-testid={`redeem-claim-${v.legs[i].symbol}`} data-raw={o.units.toString()}>claim of {fmtShares(o.units)} units</td><td colSpan={3}>{v.legs[i].unavailable.join(", ")}: pays after the leg is available again</td></>)
                  : o.action === "pay" ? (<><td>pending sale</td><td>{fmtRaw(o.gross)}</td><td colSpan={2}>sold for USDC at settlement</td></>) : <td colSpan={4}>retired</td>}
                {p.quoteRedeem && <td data-testid={`redeem-usd-${v.legs[i].symbol}`}>{usd[i] != null ? fmtUsd(usd[i]) : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button disabled={!pos || p.busy || !preview || "error" in preview || (pos && preview && !("error" in preview) && preview.s > pos.shares) || (mode === "usdc" && !!p.usdcReady)}
        onClick={() => preview && !("error" in preview) && p.onRedeem(preview.s, mode)} data-testid="redeem-submit">Redeem</button>
      {mode === "usdc" && p.usdcReady && <div className="warnline">{p.usdcReady}</div>}
    </section>
  );
}

export { transferFee, TOKEN_2022_PROGRAM_ID };
