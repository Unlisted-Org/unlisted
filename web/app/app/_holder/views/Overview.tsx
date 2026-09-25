// The Overview: the whole story, performable in one view.
//   buy in → the issuer pauses one company → redeem anyway (six pay now, one becomes a claim)
//   → the pause lifts → the claim pays out.
// The seven company tiles carry the state; the two actions and the issuer control drive it.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BasketView, CONSTITUENTS, math, planInKindDeposit, transferFee } from "@unlisted/sdk";
import { useHolder } from "../context";
import type { Position } from "../state";
import { Banners, claimsOf, issuerBanners, TxLog, type ClaimRow } from "../components/Panels";
import { fmtRaw, fmtShares, fmtUsd, parseUnits } from "../format";

const REASON: Record<string, string> = { paused: "Paused by the issuer", hook: "Transfer hook set", frozen: "Vault frozen", vault_missing: "Vault missing" };
const nameOf = (sym: string) => CONSTITUENTS.find((c) => c.symbol === sym)?.name ?? sym;

/** The most shares the wallet's own leg balances can mint, net of the issuer's transfer fee. */
function maxInKind(v: BasketView, pos: Position): bigint {
  let best: bigint | null = null;
  for (const [i, l] of v.legs.entries()) {
    const bal = pos.legBalances[i];
    const own = math.owned(l.state);
    if (own === 0n) continue;
    const net = bal - transferFee(bal, l.feeNow);
    const m = (net * (v.shareSupply + l.state.claimUnits)) / own;
    best = best === null || m < best ? m : best;
  }
  return best ?? 0n;
}

const toUnits = (raw: bigint) => (Number(raw) / 1e9).toFixed(9).replace(/\.?0+$/, "");

export function Overview() {
  const h = useHolder();
  const { view: v, pos } = h;
  const { setVisible } = useWalletModal();
  const [redeemIn, setRedeemIn] = useState<string>("");
  if (!v) return <Reading error={h.chainError} />;

  const claims = claimsOf(pos);
  const connected = !!h.owner;
  const redeemRaw = (() => { try { return redeemIn ? parseUnits(redeemIn, 9) : pos?.shares ?? 0n; } catch { return -1n; } })();
  const preview = pos && redeemRaw > 0n && redeemRaw <= pos.shares
    ? math.redeemInKind(v.legs.map((l) => l.state), v.shareSupply, redeemRaw, v.legs.map((l) => l.feeNow)) : null;
  const worth = h.apiPos?.values?.sell_now?.usd;

  return (
    <div className="page overview">
      <header className="pagehead">
        <h1>Overview</h1>
        <p className="muted">Seven pre-IPO companies in one token. When the issuer pauses one, you can still redeem: the other six pay now and the seventh becomes a claim.</p>
      </header>

      <Banners banners={issuerBanners(v, h.events.rows, h.apiEvents)} quiet />

      <section className="position-line" data-testid="position">
        {!connected ? (
          <><span>Connect a wallet to buy in and redeem. Everything else here reads the basket without one.</span>
            <button onClick={() => setVisible(true)} data-testid="position-connect">Connect wallet</button></>
        ) : !pos ? <span className="muted">Reading your balances…</span> : (
          <>
            <span className="big-line"><span className="mono" data-testid="position-shares-summary" data-raw={pos.shares.toString()}>{fmtShares(pos.shares)}</span> shares</span>
            {pos.shares > 0n && worth != null && <span className="muted" data-testid="position-value">worth <b className="mono">{fmtUsd(worth)}</b> if you redeemed now</span>}
            {claims.length > 0 && <Link href="/app/claims" className="claimlink" data-testid="position-open-claims">{claims.length} open claim{claims.length > 1 ? "s" : ""}</Link>}
          </>
        )}
      </section>

      <section className="tiles-wrap" aria-label="The seven companies">
        <ol className="tiles" data-testid="tiles">
          {v.legs.map((l) => (
            <Tile key={l.index} v={v} leg={l.index} claim={claims.find((c) => c.leg === l.index) ?? null} pos={pos}
              out={preview?.[l.index] ?? null} onSettle={(c) => h.onSettle(c)} busy={h.busy} />
          ))}
        </ol>
      </section>

      <div className="acts">
        <BuyIn />
        <section data-testid="demo-redeem">
          <h2>Redeem</h2>
          <p className="muted">Every available company pays you now. A paused one becomes a claim on that company. Each tile shows what you would get.</p>
          {!pos || pos.shares === 0n ? <p className="muted">{connected ? "You hold no shares yet. Buy in first." : "Connect a wallet first."}</p> : (
            <>
              <label>Shares <input value={redeemIn || toUnits(pos.shares)} onChange={(e) => setRedeemIn(e.target.value)} data-testid="demo-redeem-shares" />
                <button className="linklike" onClick={() => setRedeemIn("")}>All</button></label>
              {preview && (
                <p data-testid="demo-redeem-summary">
                  {preview.filter((o) => o.action === "pay").length} pay now
                  {preview.some((o) => o.action === "claim") ? `, ${preview.filter((o) => o.action === "claim").length} becomes a claim` : ""}.
                </p>
              )}
              {redeemRaw < 0n || (pos && redeemRaw > pos.shares) ? <p className="warnline">Enter up to {fmtShares(pos.shares)} shares.</p> : null}
              <button disabled={h.busy || !preview} onClick={() => h.onRedeem(redeemRaw, "in_kind")} data-testid="demo-redeem-submit">Redeem</button>
            </>
          )}
          <p className="deeper"><Link href="/app/sell">Redeem for USDC, or see the per-company table →</Link></p>
        </section>
      </div>

      <TxLog log={h.log} explorer={h.config.explorerTx} latestOnly />

      <IssuerControl />
    </div>
  );
}

function Tile({ v, leg, claim, pos, out, onSettle, busy }: { v: BasketView; leg: number; claim: ClaimRow | null; pos: Position | null;
  out: ReturnType<typeof math.redeemInKind>[number] | null; onSettle: (c: ClaimRow) => void; busy: boolean }) {
  const l = v.legs[leg];
  const down = l.unavailable.length > 0;
  const state = down ? l.unavailable.map((r) => REASON[r] ?? r).join(", ") : "available";
  const est = claim && !down ? (() => { try { return math.settleClaim(l.state, v.shareSupply, claim.units, l.feeNow); } catch { return null; } })() : null;
  return (
    <li className={`tile ${down ? "down" : ""} ${claim ? "has-claim" : ""}`} data-testid={`tile-${l.symbol}`} data-state={down ? "unavailable" : "available"}>
      <div className="tile-head">
        <b>{nameOf(l.symbol)}</b>
        <span className="tile-state" data-testid={`tile-state-${l.symbol}`}>{state}</span>
      </div>
      <div className="tile-body">
        {claim ? (
          <>
            <span data-testid={`tile-claim-${l.symbol}`} data-raw={claim.units.toString()}>Your claim: {fmtShares(claim.units)} shares</span>
            {est && <span data-testid={`tile-estimate-${l.symbol}`} data-raw={est.net.toString()} data-gross={est.gross.toString()}>Pays {fmtRaw(est.net)} now</span>}
            <button disabled={busy || down} onClick={() => onSettle(claim)} data-testid={`tile-settle-${l.symbol}`}>{down ? "Pays when resumed" : "Settle"}</button>
          </>
        ) : out && pos && pos.shares > 0n ? (
          out.action === "claim"
            ? <span className="claimword" data-testid={`tile-claimnext-${l.symbol}`} data-raw={out.units.toString()}>If you redeem: becomes a claim</span>
            : out.action === "pay" ? <span data-testid={`tile-receive-${l.symbol}`} data-raw={out.net.toString()}>If you redeem: {fmtRaw(out.net)}</span> : null
        ) : pos ? (
          <span className="muted" data-testid={`tile-wallet-${l.symbol}`}>In your wallet: {fmtRaw(pos.legBalances[leg])}</span>
        ) : null}
      </div>
    </li>
  );
}

function BuyIn() {
  const h = useHolder();
  const { view: v, pos } = h;
  const [input, setInput] = useState<string>("");
  const max = useMemo(() => (v && pos ? maxInKind(v, pos) : 0n), [v?.slot, pos?.slot]);
  const suggested = (max * 9n) / 10n; // headroom for the basket moving before the transaction lands
  useEffect(() => setInput(""), [pos?.owner.toBase58()]);
  if (!v) return null;
  const target = (() => { try { return input ? parseUnits(input, 9) : suggested; } catch { return 0n; } })();
  const plan = pos && target > 0n ? (() => { try { return planInKindDeposit(v, pos.owner, target, 100, "11111111111111111111111111111111"); } catch { return null; } })() : null;
  const unavailable = v.legs.filter((l) => l.unavailable.length);
  const refused = unavailable.length ? `Deposits are refused while ${unavailable.map((l) => nameOf(l.symbol)).join(", ")} ${unavailable.length > 1 ? "are" : "is"} unavailable. Redeeming still works.` : !v.basket.depositsEnabled ? "New deposits are stopped by the basket authority." : null;
  const short = !!plan && !!pos && pos.legBalances.some((b, i) => b < plan.gross[i]);
  const empty = !!pos && pos.legBalances.every((b) => b === 0n);
  const lowSol = h.sol != null && h.sol < 20_000_000n;
  return (
    <section data-testid="demo-buy">
      <h2>Buy in</h2>
      <p className="muted">Deposit the seven company tokens and receive basket shares.</p>
      {refused && <div className="banner alert" data-testid="demo-buy-refused">{refused}</div>}
      {!h.owner ? <p className="muted">Connect a wallet first.</p> : !pos ? <p className="muted">Reading your balances…</p> : empty ? (
        <>
          <p>Your wallet holds none of the seven tokens. Test tokens are free on devnet: 50 test USDC and about $20 of each company.</p>
          {lowSol && <p className="warnline" data-testid="faucet-needs-sol">Your wallet needs a little devnet SOL for fees first: <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.</p>}
          <button disabled={h.busy || lowSol} onClick={() => h.faucet()} data-testid="faucet-submit">Get test tokens</button>
        </>
      ) : (
        <>
          <label>Shares <input value={input || (suggested > 0n ? toUnits(suggested) : "")} onChange={(e) => setInput(e.target.value)} data-testid="demo-buy-shares" /></label>
          {plan && <p>Mints <b className="mono" data-testid="demo-buy-expected" data-raw={plan.shares.toString()}>{fmtShares(plan.shares)}</b> shares. One wallet approval.</p>}
          {short && <p className="warnline">Your wallet doesn't hold enough of every company for this size; at most {fmtShares(max)}.</p>}
          <button disabled={h.busy || !!refused || !plan || short} onClick={() => h.onInKind(target, 100)} data-testid="demo-buy-submit">Buy in</button>
        </>
      )}
      <p className="deeper"><Link href="/app/buy">Buy with USDC, or see what each company costs →</Link></p>
    </section>
  );
}

function IssuerControl() {
  const h = useHolder();
  const v = h.view!;
  const [sym, setSym] = useState("ANTHROPIC");
  const [code, setCode] = useState<string>(() => { try { return sessionStorage.getItem("unlisted-demo-passcode") ?? ""; } catch { return ""; } });
  const leg = v.legs.find((l) => l.symbol === sym)!;
  const paused = leg.unavailable.includes("paused");
  const act = (a: "pause" | "resume") => {
    try { sessionStorage.setItem("unlisted-demo-passcode", code); } catch {}
    h.issuer(a, sym, code);
  };
  return (
    <section className="issuer-ctl" data-testid="issuer-control">
      <h2>Issuer <span className="pill alert">devnet fixture</span></h2>
      <p className="muted">PreStocks can pause any of its tokens at any time. This control does the same to the devnet fixtures, so you can watch the basket keep paying. It needs the presenter's demo passcode.</p>
      <p className="muted" data-testid="issuer-simulation-note"><b>A devnet simulation.</b> The control signs with a test key that controls only this app's fixture mints on devnet. It can't touch PreStocks' real tokens or anything on mainnet.</p>
      <div className="row">
        <label>Company <select value={sym} onChange={(e) => setSym(e.target.value)} data-testid="issuer-symbol">
          {v.legs.map((l) => <option key={l.symbol} value={l.symbol}>{nameOf(l.symbol)}{l.unavailable.includes("paused") ? " (paused)" : ""}</option>)}
        </select></label>
        <label>Passcode <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} data-testid="issuer-passcode" /></label>
        <button className="danger" disabled={h.busy || !code || paused} onClick={() => act("pause")} data-testid="issuer-pause">Pause {nameOf(sym)}</button>
        <button className="secondary" disabled={h.busy || !code || !paused} onClick={() => act("resume")} data-testid="issuer-resume">Resume</button>
      </div>
    </section>
  );
}

export function Reading({ error }: { error: string | null }) {
  return error ? <div className="banner alert" data-testid="chain-error">Can't read the basket: {error}</div> : <p className="muted" data-testid="app-reading">Reading the basket…</p>;
}
