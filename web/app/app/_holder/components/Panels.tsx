import { Component, ReactNode, useEffect, useMemo, useState } from "react";
import { BasketView, CONSTITUENTS, math, openClaims, RedemptionTicket } from "@unlisted/sdk";
import type { BasketResponse, EventsResponse } from "../valuation/types";
import { fmtAge, fmtBps, fmtRaw, fmtShares, fmtUsd, pct, short } from "../format";
import type { EventRow, Position } from "../state";
import * as copy from "../copy";

const REASON_TEXT: Record<string, string> = {
  paused: "Paused by the issuer",
  hook: "Transfer hook switched on",
  frozen: "Basket vault frozen by the issuer",
  vault_missing: "Vault account missing",
  Paused: "leg paused",
  Hook: "transfer hook set",
  Frozen: "vault frozen",
  PendingSale: "pending USDC sale",
};

// ---------------------------------------------------------------- paging

/** The ten most recent items, then "Show more" in steps of ten. Nothing is dropped, only folded. */
export function Paged<T>({ items, render, step = 10, testid }: { items: T[]; render: (x: T, i: number) => ReactNode; step?: number; testid: string }) {
  const [n, setN] = useState(step);
  return (
    <>
      <ul className="events" data-testid={testid}>{items.slice(0, n).map(render)}</ul>
      {items.length > n && (
        <button className="more" onClick={() => setN((k) => k + step)} data-testid={`${testid}-more`}>
          Show more ({items.length - n} older)
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------- basis strip

export function BasisStrip({ clusterLabel, basis, mock, slot }: { clusterLabel: string; basis: string | null; mock: string | null; slot: number | null }) {
  return (
    <div className="basis" data-testid="pricing-basis">
      <span className="pill">{clusterLabel}</span>
      <span>
        <b>Pricing basis:</b> {basis ?? "Balances are the devnet basket's. Prices are mainnet market data for the real PreStocks token each fixture mirrors."}
      </span>
      {slot != null && <span className="muted">chain read at slot <span data-testid="view-slot">{slot}</span></span>}
      {mock && <span className="pill warn" data-testid="mock-label">{mock}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- issuer banners

interface Banner { key: string; level: "alert" | "warn" | "info"; title: string; body: string; testid: string }

export function issuerBanners(v: BasketView, rows: EventRow[], api: EventsResponse | null): Banner[] {
  const out: Banner[] = [];
  for (const l of v.legs) {
    if (l.unavailable.includes("paused"))
      out.push({ key: `p${l.index}`, level: "alert", testid: `banner-paused-${l.symbol}`, title: `${l.symbol} is paused by the issuer`,
        body: `Deposits are refused while any leg is unavailable. Redemptions still pay the other ${v.legs.length - 1} legs now; ${l.symbol} becomes a claim that pays after the issuer resumes it.` });
    if (l.unavailable.includes("hook"))
      out.push({ key: `h${l.index}`, level: "alert", testid: `banner-hook-${l.symbol}`, title: `${l.symbol}: transfer hook set (${short(l.mintInfo.hookProgram!)})`,
        body: `The basket refuses to forward accounts to a hook it hasn't reviewed, so ${l.symbol} is treated as unavailable. ${copy.HOOK_GOVERNANCE}` });
    if (l.unavailable.includes("frozen"))
      out.push({ key: `f${l.index}`, level: "alert", testid: `banner-frozen-${l.symbol}`, title: `The basket's ${l.symbol} vault is frozen`,
        body: `The issuer's freeze authority froze the vault account. Redemptions turn ${l.symbol} into a claim; deposits are refused.` });
  }
  // Fee changes, grouped when identical across legs.
  const pend = v.legs.filter((l) => l.feePending);
  if (pend.length) {
    const groups = new Map<string, string[]>();
    for (const l of pend) {
      const k = `${l.feeNow?.bps ?? 0}→${l.feePending!.bps}@${l.feePending!.epoch}`;
      groups.set(k, [...(groups.get(k) ?? []), l.symbol]);
    }
    for (const [k, syms] of groups) {
      const [rates, epoch] = k.split("@");
      const [from, to] = rates.split("→").map(Number);
      out.push({ key: `fee${k}`, level: "warn", testid: "banner-fee-change", title: `Transfer fee change scheduled: ${fmtBps(from)} → ${fmtBps(to)} at epoch ${epoch}`,
        body: `${syms.length === v.legs.length ? "All seven legs" : syms.join(", ")}. Current epoch ${v.epoch}. Every deposit and redemption pays this fee on every leg, each way; at ${to} bps the fees alone on a round trip are ${roundTrip(to)}.` });
    }
  }
  for (const l of v.legs) {
    const s = l.mintInfo.scaledUi;
    if (s && BigInt(v.unixTime) < s.newMultiplierEffectiveTimestamp && s.newMultiplier !== s.multiplier)
      out.push({ key: `m${l.index}`, level: "info", testid: `banner-multiplier-${l.symbol}`, title: `${l.symbol}: display multiplier changes to ${s.newMultiplier}`,
        body: `Effective ${new Date(Number(s.newMultiplierEffectiveTimestamp) * 1000).toISOString()}. Raw balances and shares don't change; only displayed amounts do.` });
  }
  if (!v.basket.depositsEnabled)
    out.push({ key: "dep", level: "warn", testid: "banner-deposits-disabled", title: "New deposits stopped by the basket authority", body: "Redemptions and claims are unaffected; the authority has no power over them." });
  // Shortfalls observed on chain (seizures or anything else the program didn't do).
  for (const r of rows) for (const e of r.events) {
    if (e.name !== "ShortfallObserved") continue;
    const l = v.legs[e.leg];
    out.push({ key: `s${r.signature}${e.leg}`, level: "alert", testid: `banner-shortfall-${l?.symbol ?? e.leg}`,
      title: `${l?.symbol ?? `Leg ${e.leg}`}: vault dropped by ${pct(e.expected - e.actual, e.expected)} without a program transfer`,
      body: `Expected ${fmtRaw(e.expected)}, found ${fmtRaw(e.actual)} at slot ${e.slot}. Every holder, open claim and open ticket on this leg bears the same ${pct(e.expected - e.actual, e.expected)}. No later depositor makes anyone whole.` });
  }
  return out;
}

function roundTrip(bps: number): string {
  const k = 1 - bps / 10_000;
  return `${((1 - k * k) * 100).toFixed(2)}%`;
}

export function Banners({ banners, quiet = false }: { banners: Banner[]; quiet?: boolean }) {
  if (!banners.length) return quiet ? null : <div className="banner info" data-testid="no-issuer-events">No issuer action in effect on any leg at this slot.</div>;
  return (
    <div className="banners">
      {banners.map((b) => (
        <div key={b.key} className={`banner ${b.level}`} data-testid={b.testid}>
          <b>{b.title}</b>
          <div>{b.body}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- issuer activity (valuation API /v1/events)

/** Normalises the watcher's events: the service tags them {kind: "issuer", type: <event>}. */
export function issuerEvents(api: EventsResponse | null): any[] {
  return ((api?.events ?? []) as any[])
    .filter((e) => e.kind === "issuer" || e.type === "issuer")
    .map((e) => ({ ...e, name: e.kind === "issuer" ? e.type : e.kind, network: e.cluster ?? e.network }));
}

export function IssuerActivity({ api, isMock }: { api: EventsResponse | null; isMock: boolean }) {
  const evs = issuerEvents(api);
  const groups: [string, any[]][] = [["mainnet", evs.filter((e) => e.network === "mainnet")], ["fixture mints", evs.filter((e) => e.network !== "mainnet")]];
  return (
    <section data-testid="issuer-activity">
      <h2>Issuer activity</h2>
      <p className="muted">Every change the issuer's authority made, read by the watcher from the real PreStocks mints on mainnet and from the fixture mints, with before and after values. PreStocks announces none of these in advance; this list and the app's banners are the only notice.</p>
      {isMock ? <p className="muted">Needs the valuation API (not connected).</p> : groups.map(([name, list]) => (
        <div key={name}>
          <h3>{name === "mainnet" ? "Real PreStocks mints (mainnet)" : "Fixture mints"}</h3>
          {list.length === 0 ? <p className="muted">No events in the window.</p> : (
            <Paged testid={`issuer-list-${name === "mainnet" ? "mainnet" : "fixture"}`} items={list} render={(e: any, i: number) => (
                <li key={i} data-testid={`issuer-event-${e.name}`}>
                  <b>{e.name}</b> {e.symbol ?? ""} <span className="muted">{e.block_time_iso ?? `slot ${e.slot}`}</span>{" "}
                  <span className="muted">{e.before ? `${JSON.stringify(e.before)} → ` : ""}{JSON.stringify(e.after)}</span>
                  {e.signature && <span className="mono muted"> {short(e.signature)}</span>}
                </li>
              )} />
          )}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- legs table

export function LegsTable({ v, pos, api, onObserve, busy }: { v: BasketView; pos: Position | null; api: BasketResponse | null; onObserve?: (leg: number) => void; busy?: boolean }) {
  return (
    <section>
      <h2>Seven legs, equal weight at inception</h2>
      <p className="muted">Availability is read from each mint's pause and hook settings and the vault's account state at slot {v.slot}. Amounts are raw fixture tokens (9 decimals).</p>
      <div className="scroll">
        <table data-testid="legs-table">
          <thead>
            <tr>
              <th>Leg</th><th>Available?</th><th>Transfer fee now</th><th>Scheduled</th><th title="Scaled-UI multiplier in effect now. Display only: raw amounts and shares never change.">Display multiplier</th><th>Vault balance</th><th>Accounted</th><th>Claim units</th>
              <th>Per share</th><th>Weight at inception</th>{pos && <th>You hold (entitlement)</th>}
            </tr>
          </thead>
          <tbody>
            {v.legs.map((l) => {
              const ps = math.perShare(l.state, v.shareSupply);
              const perShare = ps.den === 0n ? 0n : (ps.num * 1_000_000_000n) / ps.den;
              return (
                <tr key={l.index} data-testid={`leg-row-${l.symbol}`} className={l.unavailable.length ? "unavail" : ""}>
                  <td><b>{l.symbol}</b>{CONSTITUENTS.find((c) => c.symbol === l.symbol)?.spvContested && <span className="pill warn" title="SPV dispute; see disclosures">SPV disputed</span>}</td>
                  <td data-testid={`leg-availability-${l.symbol}`}>{l.unavailable.length ? l.unavailable.map((r) => REASON_TEXT[r] ?? r).join(", ") : "available"}</td>
                  <td data-testid={`leg-fee-${l.symbol}`}>{l.feeNow ? `${l.feeNow.bps} bps` : "none"}</td>
                  <td>{l.feePending ? `${l.feePending.bps} bps from epoch ${l.feePending.epoch}` : "—"}</td>
                  {/* The EFFECTIVE multiplier (spec 01): the mint's stored `multiplier` field is superseded once newMultiplier's timestamp passes. */}
                  <td data-testid={`leg-multiplier-${l.symbol}`} data-value={String(l.multiplier)}>
                    {l.mintInfo.scaledUi ? `×${l.multiplier}` : "none"}
                    {l.mintInfo.scaledUi && l.mintInfo.scaledUi.multiplier !== l.multiplier && <span className="muted"> (stored field {l.mintInfo.scaledUi.multiplier}, superseded)</span>}
                  </td>
                  <td data-testid={`leg-balance-${l.symbol}`} data-raw={l.state.balance.toString()}>{fmtRaw(l.state.balance)}</td>
                  <td>{fmtRaw(l.state.accounted)}
                    {l.state.balance < l.state.accounted && (
                      <>
                        <span className="pill alert" data-testid={`unobserved-shortfall-${l.symbol}`} data-raw={(l.state.accounted - l.state.balance).toString()}>
                          −{pct(l.state.accounted - l.state.balance, l.state.accounted)} not yet recorded
                        </span>
                        {onObserve && <button disabled={busy} onClick={() => onObserve(l.index)} data-testid={`observe-${l.symbol}`} title="Permissionless: records the drop on chain so everyone sees it">Record it (observe)</button>}
                      </>
                    )}</td>
                  <td data-testid={`leg-claims-${l.symbol}`} data-raw={l.state.claimUnits.toString()}>{fmtShares(l.state.claimUnits)}</td>
                  <td title={`exact: ${ps.num} / ${ps.den}`}>{fmtRaw(perShare)}</td>
                  <td>{api?.weights.inception.find((w) => w.index === l.index)?.value_share ?? "1/7"}</td>
                  {pos && <td>{fmtRaw(math.holderAmount(l.state, v.shareSupply, pos.shares))}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">Share supply {fmtShares(v.shareSupply)}. Per-share amount = owned / (supply + claim units), kept as an exact ratio (hover a cell).</p>
    </section>
  );
}

// ---------------------------------------------------------------- price panel

export function PricePanel({ api, error, title = "What one share is worth", testid = "price-panel" }: { api: BasketResponse | null; error: string | null; title?: string; testid?: string }) {
  if (error) return <section data-testid={testid}><h2>{title}</h2><div className="banner warn">Valuation API unavailable: {error}. No value is shown rather than a guessed one.</div></section>;
  if (!api) return <section data-testid={testid}><h2>{title}</h2><p className="muted">Loading…</p></section>;
  if (!api.values?.sell_now || !api.values?.last_trade || !api.values?.reference)
    return <section data-testid={testid}><h2>{title}</h2><div className="banner warn">The valuation API returned no values for this view{(api as any).values_error ? `: ${(api as any).values_error}` : ""}. No value is shown rather than a guessed one.</div></section>;
  const v = api.values;
  const ageOf = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 1000 : null);
  const refAge = v.reference.legs.length ? Math.max(...v.reference.legs.map((l) => ageOf(l.fetched_at) ?? 0)) : null;
  const sellTimes = v.sell_now.legs.map((l: any) => l.quoted_at as string | undefined).filter(Boolean) as string[];
  const sellAge = sellTimes.length ? Math.max(...sellTimes.map((t) => ageOf(t) ?? 0)) : null;
  const sellSlots = v.sell_now.legs.map((l) => l.quoted_at_slot).filter((x) => typeof x === "number");
  // unquotable_legs: spec 03's example shows indices; the service returns {index, symbol, reason}.
  const unq = (v.sell_now.unquotable_legs as any[]).map((u) => (typeof u === "number" ? { index: u, symbol: api.legs[u]?.symbol, reason: "" } : u));
  const sym = (i: number) => api.legs.find((l) => l.index === i)?.symbol ?? `leg ${i}`;
  return (
    <section data-testid={testid}>
      <h2>{title}</h2>
      <div className="cards3 lead">
        <div className="card" data-testid="value-sell-now">
          <div className="label">{v.sell_now.label}</div>
          <div className="big" data-usd={v.sell_now.usd}>{fmtUsd(v.sell_now.usd)}</div>
          <div className="muted">Live fee-inclusive sell quotes of the mirrored mainnet tokens, Manifest excluded. {sellAge != null ? `Oldest quote ${fmtAge(sellAge)}` : sellSlots.length ? `Quoted at mainnet slot ${Math.min(...sellSlots)}` : ""}.</div>
          {unq.length > 0 && <div className="warnline" data-testid="unquotable">Valued at 0 here (no route): {unq.map((u) => u.symbol ?? sym(u.index)).join(", ")}</div>}
        </div>
      </div>
      <details className="value-more" data-testid="value-more">
        <summary>Two other values, and the gaps between them</summary>
      <div className="cards3">
        <div className="card" data-testid="value-last-trade">
          <div className="label">{v.last_trade.label}</div>
          <div className="big" data-usd={v.last_trade.usd}>{fmtUsd(v.last_trade.usd)}</div>
          <div className="muted">Oldest leg {fmtAge(v.last_trade.oldest_age_s)}.</div>
          {v.last_trade.oldest_age_s > 900 && <div className="warnline">A leg's last trade is over 15 minutes old.</div>}
        </div>
        <div className="card" data-testid="value-reference">
          <div className="label">{v.reference.label}</div>
          <div className="big" data-usd={v.reference.usd}>{fmtUsd(v.reference.usd)}</div>
          <div className="muted">Issuer's off-chain estimate; you can't trade at it. Fetched {fmtAge(refAge)}.</div>
        </div>
      </div>
      <p className="muted">
        Gaps: sell-now vs last trade {v.gaps.sell_now_vs_last_trade_bps} bps; reference vs last trade {v.gaps.reference_vs_last_trade_bps} bps.
      </p>
      {(api.warnings ?? []).length > 0 && <ul className="warnline">{api.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <details>
        <summary>Per leg, with sources and ages</summary>
        <div className="scroll">
          <table data-testid="price-legs">
            <thead><tr><th>Leg</th><th>If redeemed now</th><th>Route</th><th>Last trade</th><th>Age</th><th>Reference</th><th>Fetched</th></tr></thead>
            <tbody>
              {api.legs.map((l) => {
                const sn: any = v.sell_now.legs.find((x) => x.index === l.index);
                const lt: any = v.last_trade.legs.find((x) => x.index === l.index);
                const rf: any = v.reference.legs.find((x) => x.index === l.index);
                const u = unq.find((x) => x.index === l.index);
                return (
                  <tr key={l.index}>
                    <td>{l.symbol}</td>
                    <td>{sn ? fmtUsd(sn.usd) : u ? "0 (no route)" : "—"}</td>
                    <td className="muted">{sn?.route ?? (u?.reason ? String(u.reason).slice(0, 60) : "—")}</td>
                    <td>{lt?.usd != null ? fmtUsd(lt.usd) : "—"}</td>
                    <td>{fmtAge(lt?.age_s)}</td>
                    <td>{rf?.usd != null ? fmtUsd(rf.usd) : "—"}</td>
                    <td>{fmtAge(ageOf(rf?.fetched_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------- claims

export interface ClaimRow { ticket: string; nonce: bigint; leg: number; units: bigint; reason: string }

export function claimsOf(pos: Position | null): ClaimRow[] {
  if (!pos) return [];
  return pos.redemptions.flatMap(({ address, ticket }) =>
    openClaims(ticket).map((c) => ({ ticket: address.toBase58(), nonce: ticket.nonce, leg: c.leg, units: c.units, reason: c.reason })));
}

// ---------------------------------------------------------------- open deposit tickets

/** A USDC deposit that didn't finish: landed legs are unwound back to USDC, then the escrow is refunded. */
export function OpenDepositTickets({ v, pos, onAbort, busy }: { v: BasketView; pos: Position | null; onAbort: (ticket: string) => void; busy: boolean }) {
  const list = pos?.deposits ?? [];
  if (!list.length) return null;
  return (
    <section data-testid="open-deposit-tickets">
      <h2>Unfinished USDC deposits</h2>
      <p className="muted">A deposit ticket holds your USDC until all seven legs land. If it can't finish, abort it: each landed leg is sold back to USDC into the escrow, then the escrow is refunded to you and every account the ticket opened is closed (rent back to you).</p>
      <table>
        <thead><tr><th>Ticket</th><th>USDC in</th><th>Landed legs</th><th>Expires</th><th></th></tr></thead>
        <tbody>
          {list.map(({ address, ticket: t }) => {
            const landed = v.legs.filter((l) => t.landedMask & (1 << l.index)).map((l) => l.symbol);
            const expired = BigInt(v.slot) > t.expirySlot;
            return (
              <tr key={address.toBase58()} data-testid={`deposit-ticket-${address.toBase58()}`}>
                <td className="mono">{short(address.toBase58())}</td>
                <td>{(Number(t.usdcIn) / 1e6).toFixed(6)}</td>
                <td data-testid="deposit-ticket-landed">{landed.length ? landed.join(", ") : "none"}</td>
                <td>{expired ? "expired" : `slot ${t.expirySlot}`}</td>
                <td><button disabled={busy} data-testid={`abort-${address.toBase58()}`} onClick={() => onAbort(address.toBase58())}>Abort and refund</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function ClaimsList({ v, pos, onSettle, busy, usdcRouter, rows }: { v: BasketView; pos: Position | null; onSettle: (c: ClaimRow, usdc?: boolean) => void; busy: boolean; usdcRouter: boolean; rows: EventRow[] }) {
  const claims = claimsOf(pos);
  const settled = pos ? rows.flatMap((r) => r.events.filter((e) => e.name === "ClaimSettled" && e.owner.equals(pos.owner)).map((e) => ({ r, e: e as Extract<typeof e, { name: "ClaimSettled" }> }))) : [];
  return (
    <section data-testid="claims">
      <h2>Your claims</h2>
      <p className="muted">{copy.CLAIM_NOTE}</p>
      {!pos ? <p className="muted">Connect a wallet to see claims.</p> : claims.length === 0 ? <p data-testid="no-claims">No open claims.</p> : (
        <table>
          <thead><tr><th>Leg</th><th>Units (burned shares)</th><th>Reason</th><th>Leg now</th><th>Would pay now</th><th></th></tr></thead>
          <tbody>
            {claims.map((c) => {
              const l = v.legs[c.leg];
              let est = "—";
              let estRaw = "";
              let estGross = "";
              try { const s = math.settleClaim(l.state, v.shareSupply, c.units, l.feeNow); est = `${fmtRaw(s.net)} net (${fmtRaw(s.gross)} gross)`; estRaw = s.net.toString(); estGross = s.gross.toString(); } catch { est = "waits for the leg"; }
              return (
                <tr key={`${c.ticket}-${c.leg}`} data-testid={`claim-${l.symbol}`}>
                  <td><b>{l.symbol}</b></td>
                  <td data-testid={`claim-units-${l.symbol}`} data-raw={c.units.toString()}>{fmtShares(c.units)}</td>
                  <td data-testid={`claim-reason-${l.symbol}`}>{REASON_TEXT[c.reason] ?? c.reason}</td>
                  <td data-testid={`claim-leg-state-${l.symbol}`}>{l.unavailable.length ? l.unavailable.map((r) => REASON_TEXT[r] ?? r).join(", ") : "available"}</td>
                  <td data-testid={`claim-estimate-${l.symbol}`} data-raw={estRaw} data-gross={estGross}>{est}</td>
                  <td>
                    <button disabled={busy || l.unavailable.length > 0 || (c.reason === "PendingSale" && !usdcRouter)} onClick={() => onSettle(c, c.reason === "PendingSale")} data-testid={`settle-${l.symbol}`}>
                      {l.unavailable.length ? "Waiting for resume" : c.reason === "PendingSale" ? "Sell for USDC" : "Settle in kind"}
                    </button>
                    {c.reason === "PendingSale" && !l.unavailable.length && (
                      <button disabled={busy} onClick={() => onSettle(c, false)} title="Fallback when no route works" data-testid={`settle-inkind-${l.symbol}`}>In kind instead</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {settled.length > 0 && (
        <>
          <h3>Settled claims (from ClaimSettled events on chain)</h3>
          <table data-testid="settled-claims">
            <thead><tr><th>Leg</th><th>Units</th><th>You received</th><th>Gross from vault</th><th>Slot</th><th>Signature</th></tr></thead>
            <tbody>
              {settled.map(({ r, e }) => (
                <tr key={`${r.signature}-${e.leg}`} data-testid={`settled-${v.legs[e.leg]?.symbol}`}>
                  <td><b>{v.legs[e.leg]?.symbol}</b></td><td>{fmtShares(e.units)}</td>
                  <td data-testid={`settled-received-${v.legs[e.leg]?.symbol}`} data-raw={e.received.toString()}>{fmtRaw(e.received)}</td>
                  <td className="muted" data-testid={`settled-gross-${v.legs[e.leg]?.symbol}`} data-raw={e.amount.toString()}>{fmtRaw(e.amount)}</td>
                  <td>{r.slot}</td><td className="mono">{r.signature}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function RedemptionHistory({ v, pos }: { v: BasketView; pos: Position | null }) {
  if (!pos || pos.redemptions.length === 0) return null;
  return (
    <section data-testid="redemptions">
      <h2>Your redemptions</h2>
      {pos.redemptions.map(({ address, ticket }) => <TicketCard key={address.toBase58()} v={v} address={address.toBase58()} t={ticket} />)}
    </section>
  );
}

function TicketCard({ v, address, t }: { v: BasketView; address: string; t: RedemptionTicket }) {
  return (
    <div className="card" data-testid={`redemption-${address}`}>
      <div><b>{fmtShares(t.sharesBurned)} shares burned</b> · {t.mode.kind === "InKind" ? "in kind" : "USDC"} · ticket {short(address)}</div>
      <div className="legchips">
        {t.legs.slice(0, v.legs.length).map((l, i) => (
          <span key={i} className={`chip ${l.kind === "Claim" && l.units > 0n ? "claim" : l.kind === "Paid" ? "paid" : ""}`} data-testid={`redemption-leg-${v.legs[i].symbol}`}>
            {v.legs[i].symbol}: {l.kind === "Paid" ? `received ${fmtRaw(l.received)} (gross ${fmtRaw(l.amount)})` : l.kind === "Claim" ? (l.units > 0n ? `claim ${fmtShares(l.units)} (${REASON_TEXT[l.reason]})` : "claim settled") : "—"}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- events

export function EventsPanel({ v, rows }: { v: BasketView; rows: EventRow[] }) {
  const sym = (i: number) => v.legs[i]?.symbol ?? `leg ${i}`;
  const lines = rows.flatMap((r) => r.events.map((e, k) => ({ r, e, k })));
  return (
    <section data-testid="events">
      <h2>On-chain events</h2>
      {lines.length === 0 ? <p className="muted">No basket events in the recent transactions.</p> : (
        <Paged testid="event-list" items={lines} render={({ r, e, k }) => (
            <li key={`${r.signature}-${k}`} data-testid={`event-${e.name}`}>
              <span className="muted">slot {r.slot}</span> <b>{e.name}</b>{" "}
              {e.name === "ShortfallObserved" && <>{sym(e.leg)}: {fmtRaw(e.expected)} → {fmtRaw(e.actual)} (−{pct(e.expected - e.actual, e.expected)}, shared pro rata)</>}
              {e.name === "SurplusObserved" && <>{sym(e.leg)}: {fmtRaw(e.expected)} → {fmtRaw(e.actual)} (accrues to holders and claims)</>}
              {e.name === "ClaimCreated" && <>{sym(e.leg)}: {fmtShares(e.units)} units, {e.reason}</>}
              {e.name === "ClaimSettled" && <>{sym(e.leg)}: {fmtShares(e.units)} units, owner received {fmtRaw(e.received)} (gross {fmtRaw(e.amount)} from the vault)</>}
              {e.name === "Minted" && <>{fmtShares(e.shares)} shares ({e.path})</>}
              {e.name === "Redeemed" && <>{fmtShares(e.shares)} shares, claims on {[...Array(8).keys()].filter((i) => (e.claimsMask >> i) & 1).map(sym).join(", ") || "none"}</>}
              {e.name === "LegListing" && <>{sym(e.leg)} listed; conversion after {new Date(Number(e.convertAfter) * 1000).toISOString()}</>}
              {" "}<span className="mono muted">{short(r.signature)}</span>
            </li>
          )} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- disclosures

export function Disclosures({ upgradeAuthority, authority }: { upgradeAuthority: string | null; authority: string }) {
  return (
    <section className="disclosures" data-testid="disclosures">
      <h2>Disclosures</h2>
      <h3>OpenAI and Anthropic: the SPV dispute</h3>
      <p data-testid="spv-disclosure">{copy.SPV_DISCLOSURE}</p>
      <h3>The issuer</h3>
      <p>{copy.ISSUER_POWERS}</p>
      <p><b>{copy.NOT_PROTECTION}</b></p>
      <p data-testid="no-advance-notice">{copy.NO_ADVANCE_NOTICE}</p>
      <h3>Cost</h3>
      <p>{copy.COST_PLAIN}</p>
      <h3>The basket's own authority</h3>
      <p>{copy.AUTHORITY_LIMITS} Basket authority: <span className="mono">{authority}</span>. Program upgrade authority: <span className="mono">{upgradeAuthority ?? "not stated in config"}</span> (held by the deployer on devnet).</p>
      <p className="muted">{copy.TEST_NETWORK} {copy.NOT_ENDORSED}</p>
    </section>
  );
}

// ---------------------------------------------------------------- tx log

export interface TxRecord { id: string; label: string; signatures: string[]; status: "ok" | "failed" | "pending"; error?: string; approvals: number; at: string; retries?: string[] }

export function TxLog({ log, explorer, latestOnly = false }: { log: TxRecord[]; explorer: string | null; latestOnly?: boolean }) {
  if (!log.length) return null;
  if (latestOnly) log = log.slice(0, 1);
  return (
    <section data-testid={latestOnly ? "tx-latest" : "tx-log"}>
      <h2>{latestOnly ? "Your last transaction" : "This session's transactions"}</h2>
      <ul className="events">
        {log.map((t, i) => (
          <li key={t.id} data-testid={latestOnly ? `tx-${i}` : `txlog-${i}`} data-status={t.status}>
            <b>{t.label}</b>: <span data-testid={`${latestOnly ? "tx" : "txlog"}-status-${i}`}>{t.status}</span> · {t.signatures.length} transaction(s), {t.approvals} wallet approval(s)
            {t.retries?.length ? <div className="muted" data-testid={`${latestOnly ? "tx" : "txlog"}-retries-${i}`}>Re-sent after a transient RPC error ({t.retries.length}×; same signed transaction): {t.retries.join("; ")}</div> : null}
            {t.error && <div className="warnline">{t.error}</div>}
            {t.signatures.map((s) => (
              <div key={s} className="mono" data-testid={latestOnly ? "tx-signature" : "txlog-signature"}>{explorer ? <a href={explorer.replace("{sig}", s)} target="_blank" rel="noreferrer">{s}</a> : s}</div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return n;
}

export function useMemoStable<T>(f: () => T, deps: unknown[]): T { return useMemo(f, deps); }

/** Keeps one panel's failure (e.g. an unexpected API shape) from blanking the whole app. */
export class Guard extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: String((e as any)?.message ?? e) }; }
  render() {
    return this.state.error ? <section><div className="banner warn" data-testid="panel-error">{this.props.name} could not render: {this.state.error}</div></section> : this.props.children;
  }
}
