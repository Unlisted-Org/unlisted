// The five routes behind the Overview. Each has one job; the Overview links into them.
import { useHolder } from "../context";
import { DepositPanel, RedeemPanel } from "../components/Actions";
import {
  BasisStrip, ClaimsList, Disclosures, EventsPanel, Guard, IssuerActivity, LegsTable, OpenDepositTickets, PricePanel, RedemptionHistory, TxLog,
} from "../components/Panels";
import * as copy from "../copy";
import { fmtShares, short } from "../format";
import { Reading } from "./Overview";

function Head({ title, lede }: { title: string; lede: string }) {
  return (
    <header className="pagehead">
      <h1>{title}</h1>
      <p className="muted">{lede}</p>
    </header>
  );
}

/** Buy: in kind or with USDC, with the full per-company split and the cost stated after the action. */
export function Buy() {
  const h = useHolder();
  if (!h.view) return <Reading error={h.chainError} />;
  return (
    <div className="page">
      <Head title="Buy" lede="Deposit the seven company tokens, or USDC, and receive basket shares." />
      <DepositPanel v={h.view} pos={h.pos} busy={h.busy} routerReady={h.routerReady} quoteDeposit={(u) => h.valuation.quoteDeposit(h.view!, u)} onInKind={h.onInKind} onUsdc={h.onUsdc} />
      <TxLog log={h.log} explorer={h.config.explorerTx} latestOnly />
    </div>
  );
}

/** Sell: redeem in kind or for USDC, with every company's outcome before you sign. */
export function Sell() {
  const h = useHolder();
  if (!h.view) return <Reading error={h.chainError} />;
  return (
    <div className="page">
      <Head title="Sell" lede="Redeem shares for the seven tokens or for USDC. A redemption never fails because one company is unavailable." />
      {h.pos && h.pos.shares > 0n && !h.valuation.isMock && (
        <Guard name="Position value"><PricePanel api={h.apiPos} error={h.apiPosErr} testid="position-price-panel" title={`Your ${fmtShares(h.pos.shares)} shares, valued three ways`} /></Guard>
      )}
      <RedeemPanel v={h.view} pos={h.pos} busy={h.busy} onRedeem={h.onRedeem}
        usdcReady={h.usdcRouter ? null : "USDC redemption settles through the devnet router, not configured on this cluster yet."}
        quoteRedeem={h.valuation.isMock ? null : (s, m) => h.valuation.quoteRedeem(h.view!, s, m)} />
      <TxLog log={h.log} explorer={h.config.explorerTx} latestOnly />
    </div>
  );
}

/** Claims: what you're still owed, unfinished USDC deposits, and every redemption's outcome. */
export function Claims() {
  const h = useHolder();
  if (!h.view) return <Reading error={h.chainError} />;
  return (
    <div className="page">
      <Head title="Claims" lede="A claim is what a redemption leaves you on a company that was unavailable. It pays out once the company is available again." />
      <ClaimsList v={h.view} pos={h.pos} onSettle={h.onSettle} busy={h.busy} usdcRouter={h.usdcRouter} rows={h.events.rows} />
      <OpenDepositTickets v={h.view} pos={h.pos} onAbort={h.onAbort} busy={h.busy} />
      <RedemptionHistory v={h.view} pos={h.pos} />
      <TxLog log={h.log} explorer={h.config.explorerTx} latestOnly />
    </div>
  );
}

/** Basket: what one share is worth three ways, the seven companies in the vault, and the disclosures. */
export function Basket() {
  const h = useHolder();
  if (!h.view) return <Reading error={h.chainError} />;
  const v = h.view;
  return (
    <div className="page">
      <Head title="Basket" lede="What's in the vault, what a share is worth, and what the issuer and the basket's own authority can do." />
      <BasisStrip clusterLabel={h.config.clusterLabel} basis={h.api?.pricing_basis.text ?? null} mock={h.valuation.isMock ? (h.api?.mock ?? "MOCK valuation") : null} slot={v.slot} />
      <Guard name="Price panel"><PricePanel api={h.api} error={h.apiErr} /></Guard>
      <LegsTable v={v} pos={h.pos} api={h.api} onObserve={h.owner ? h.onObserve : undefined} busy={h.busy} />
      <section className="intro" data-testid="how-it-works">
        <h2>How it works</h2>
        <p>{copy.ISSUER_POWERS}</p>
        <ul>{copy.WHAT_THIS_BASKET_DOES.map((t) => <li key={t}>{t}</li>)}</ul>
        <p><b>{copy.NOT_PROTECTION}</b></p>
      </section>
      <Disclosures upgradeAuthority={h.config.upgradeAuthority} authority={short(v.basket.authority)} />
    </div>
  );
}

/** History: this session's transactions, the basket's on-chain events, and every issuer change. */
export function History() {
  const h = useHolder();
  if (!h.view) return <Reading error={h.chainError} />;
  return (
    <div className="page">
      <Head title="History" lede="Your transactions this session, the basket's own events on chain, and every change the issuer has made to the mints." />
      {h.log.length ? <TxLog log={h.log} explorer={h.config.explorerTx} /> : <section data-testid="tx-log-empty"><h2>This session's transactions</h2><p className="muted">None yet.</p></section>}
      <EventsPanel v={h.view} rows={h.events.rows} />
      <Guard name="Issuer activity"><IssuerActivity api={h.apiEvents} isMock={h.valuation.isMock} /></Guard>
    </div>
  );
}
