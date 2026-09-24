// The valuation API's computations (spec 03). Every figure carries `source` and `as_of`.

import { PublicKey } from "./lib/web3.ts";
import { Rpc } from "./lib/rpc.ts";
import { readBasket } from "./lib/basket.ts";
import type { BasketView, LegView } from "./lib/basket.ts";
import { entitlement, perShare, quoteRedeem, sharesForDeltas, observe, pendingActual } from "./lib/sharemath.ts";
import { effectiveMultiplier, feeSchedule, issuerControls } from "./lib/token2022.ts";
import { jupiterLastTrade, prestocksMarks, jupiterSellQuote, EXCLUDE_DEXES } from "./lib/sources.ts";
import type { SellQuote } from "./lib/sources.ts";
import { poolAccounts, quoteSwap, SIDE_BUY, decodePool } from "./lib/amm.ts";
import { decodeMultisig } from "./lib/squads.ts";
import { accountDiscriminator, decodeAccount } from "./lib/idl.ts";
import { PRESTOCKS_MULTISIG } from "./lib/prestocks.ts";
import type { Config } from "./config.ts";
import type { Watcher } from "./watcher.ts";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const bps = (a: number, b: number) => (b ? Math.round((a / b - 1) * 10_000) : null);
const usd = (x: number) => x.toFixed(6);
const LAST_TRADE_WARN_S = 15 * 60;
const DEFAULT_SLIPPAGE_BPS = 150;

/** Small TTL cache for upstream calls. */
class Cache {
  m = new Map<string, { at: number; v: any }>();
  async get<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
    const hit = this.m.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
    const v = await f();
    this.m.set(key, { at: Date.now(), v });
    return v;
  }
}

export class Valuation {
  cfg: Config;
  rpc: Rpc;
  mainnet: Rpc;
  watcher?: Watcher;
  cache = new Cache();
  blockTimes = new Map<number, number | null>();

  constructor(cfg: Config, watcher?: Watcher) {
    this.cfg = cfg;
    this.rpc = cfg.rpc;
    this.mainnet = cfg.mainnet;
    this.watcher = watcher;
  }

  pricingBasis() {
    return {
      kind: "mainnet_mirror",
      text: "Balances are the devnet basket's. Prices are mainnet market data for the real PreStocks token each fixture mirrors.",
    };
  }

  basketSourceNote(b: BasketView) {
    return b.source === "program"
      ? { kind: "program", text: `Basket account ${b.basket} of program ${b.program}, decoded with the program's IDL.` }
      : { kind: "standin", text: "Stand-in basket: real vaults and share mint on chain; A/C/P/L from fixtures/standin-basket.json. Not the basket program." };
  }

  async basket(): Promise<BasketView> {
    return readBasket(this.rpc, this.cfg.basket);
  }

  // ---------- mainnet market data ----------

  async mainnetMints(mints: string[]) {
    return this.cache.get(`mm:${mints.join()}`, 30_000, async () => {
      const r = await this.mainnet.accounts(mints);
      const epoch = (await this.cache.get("mepoch", 60_000, () => this.mainnet.epochInfo())).epoch;
      return { slot: r.slot, epoch, infos: r.values.map((v) => v?.data?.parsed?.info) };
    });
  }

  async blockTime(slot: number): Promise<number | null> {
    if (this.blockTimes.has(slot)) return this.blockTimes.get(slot)!;
    const t = await this.mainnet.blockTime(slot).catch(() => null);
    this.blockTimes.set(slot, t);
    return t;
  }

  async lastTrades(mints: string[]) {
    return this.cache.get(`lt:${mints.join()}`, 15_000, () => jupiterLastTrade(mints));
  }

  async marks() {
    return this.cache.get("marks", 60_000, () => prestocksMarks());
  }

  /**
   * Taker for a Jupiter /build quote. The quote itself does not depend on the taker (checked: identical
   * outAmount with a holder and with an unrelated wallet), but a route can only be *simulated* for a
   * taker that holds the input. So: a cached on-curve holder with enough balance when one is known,
   * otherwise QUOTE_TAKER. Holder lookups are serialised and cached for an hour (public RPC limits).
   */
  holderChain: Promise<unknown> = Promise.resolve();
  async takerFor(mint: string, amount: bigint): Promise<{ taker: string; holds_input: boolean }> {
    const fallback = process.env.QUOTE_TAKER ?? "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS";
    const holders: any[] | null = await this.holders(mint).catch(() => null);
    const h = holders?.find((x: any) => x.amount >= amount);
    return h ? { taker: h.owner, holds_input: true } : { taker: fallback, holds_input: false };
  }

  holders(mint: string): Promise<{ owner: string; amount: bigint }[]> {
    const run = () => this.cache.get(`holders:${mint}`, 3_600_000, async () => {
      const r = await this.mainnet.call("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
      const accs = await this.mainnet.accounts(r.value.map((x: any) => x.address));
      return accs.values
        .map((a: any, i: number) => ({ owner: a?.data?.parsed?.info?.owner, amount: BigInt(r.value[i].amount) }))
        .filter((h: any) => h.owner && PublicKey.isOnCurve(new PublicKey(h.owner).toBytes()));
    });
    const p = this.holderChain.then(run, run);
    this.holderChain = p.catch(() => undefined);
    return p;
  }

  async sellQuote(mint: string, amount: bigint, fresh = false): Promise<(SellQuote & { quoted_at_slot: number | null; taker_holds_input: boolean }) | { error: string }> {
    if (amount <= 0n) return { error: "zero amount" };
    return this.cache.get(`sq:${mint}:${amount}`, fresh ? 0 : 20_000, async () => {
      try {
        const t = await this.takerFor(mint, amount);
        const q = await jupiterSellQuote(mint, amount, t.taker);
        const quoted_at_slot = await this.mainnet.slot().catch(() => null);
        return { ...q, quoted_at_slot, taker_holds_input: t.holds_input };
      } catch (e: any) {
        return { error: String(e?.message ?? e).slice(0, 300) };
      }
    });
  }

  // ---------- the three values for given per-leg raw amounts ----------

  async values(b: BasketView, amounts: bigint[], opts: { claimed?: boolean[]; includeBuilds?: boolean; fresh?: boolean } = {}) {
    const legs = b.legs.filter((l) => l.status !== "retired");
    const mints = legs.map((l) => l.mirror_of);
    const [lt, marks, mm] = await Promise.all([this.lastTrades(mints), this.marks(), this.mainnetMints(mints)]);
    const now = Math.floor(Date.now() / 1000);

    const quotes = await Promise.all(legs.map((l) => this.sellQuote(l.mirror_of, amounts[l.index], opts.fresh)));
    const sellLegs: any[] = [];
    const unquotable: any[] = [];
    let sellUsd = 0, sellPaidNow = 0;
    legs.forEach((l, k) => {
      const q: any = quotes[k];
      if (amounts[l.index] === 0n) return;
      if (q.error) {
        unquotable.push({ index: l.index, symbol: l.symbol, reason: q.error, kind: /HTTP (429|5\d\d)|fetch failed|timeout/i.test(q.error) ? "upstream_error" : "no_route" });
        return;
      }
      const v = Number(q.out_usdc_raw) / 1e6;
      sellUsd += v;
      if (!opts.claimed?.[l.index]) sellPaidNow += v;
      sellLegs.push({
        index: l.index, symbol: l.symbol, amount_raw: amounts[l.index].toString(), usd: usd(v), out_usdc_raw: q.out_usdc_raw, route: q.route,
        price_impact_bps: q.price_impact_bps, fee_bps: mm.infos[k] ? feeSchedule(mm.infos[k], mm.epoch)!.now_bps : null,
        quoted_at_slot: q.quoted_at_slot, quoted_at: q.quoted_at, taker: q.taker, taker_holds_input: q.taker_holds_input, source: q.source,
        ...(opts.claimed?.[l.index] ? { claim: true } : {}),
        ...(opts.includeBuilds ? { build: q.build } : {}),
      });
    });

    const ltLegs: any[] = [];
    let ltUsd = 0, oldest = 0;
    for (const l of legs) {
      const p = lt[l.mirror_of];
      if (!p) continue;
      const t = await this.blockTime(p.block);
      const age = t ? now - t : null;
      if (age !== null) oldest = Math.max(oldest, age);
      const v = Number(amounts[l.index]) * p.usd_per_raw;
      ltUsd += v;
      ltLegs.push({ index: l.index, symbol: l.symbol, usd: usd(v), usd_per_raw: p.usd_per_raw.toPrecision(12), usd_per_unscaled_token: p.usd_per_unscaled_token, age_s: age, block: p.block, block_time: t ? new Date(t * 1000).toISOString().replace(".000Z", "Z") : null, fetched_at: p.fetched_at, source: p.source + "; age from mainnet getBlockTime(blockId)" });
    }

    const refLegs: any[] = [];
    let refUsd = 0;
    legs.forEach((l, k) => {
      const mk = marks[l.mirror_of];
      const info = mm.infos[k];
      if (!mk || !info) return;
      const em = effectiveMultiplier(info, now);
      const perRaw = (mk.mark_price_usd_per_ui * Number(em.effective)) / 10 ** l.decimals;
      const v = Number(amounts[l.index]) * perRaw;
      refUsd += v;
      refLegs.push({ index: l.index, symbol: l.symbol, usd: usd(v), usd_per_ui: String(mk.mark_price_usd_per_ui), effective_multiplier: em.effective, multiplier_source: `mainnet mint ${l.mirror_of} scaledUiAmountConfig at slot ${mm.slot}`, usd_per_raw: perRaw.toPrecision(12), fetched_at: mk.fetched_at, source: mk.source });
    });

    return {
      mainnet_slot: mm.slot,
      sell_now: {
        label: "If you redeemed now",
        usd: usd(sellUsd),
        usd_paid_now: usd(sellPaidNow),
        method: `sum over legs of live fee-inclusive sell quotes for the raw amount of the mirrored mainnet token, excluding ${EXCLUDE_DEXES} (spec 02 route rules)`,
        legs: sellLegs,
        unquotable_legs: unquotable,
      },
      last_trade: { label: "Last trade", usd: usd(ltUsd), legs: ltLegs, oldest_age_s: oldest },
      reference: { label: "PreStocks reference (off-chain estimate, not tradable)", usd: usd(refUsd), legs: refLegs },
      gaps: { sell_now_vs_last_trade_bps: bps(sellUsd, ltUsd), reference_vs_last_trade_bps: bps(refUsd, ltUsd) },
    };
  }

  legRaw(b: BasketView, l: LegView) {
    const o = observe(l.state);
    const ps = perShare(l.state, b.supply);
    return {
      balance_raw: l.state.balance.toString(),
      accounted_raw: l.state.accounted.toString(),
      pending_raw: pendingActual(o).toString(),
      claim_units: l.state.claim_units.toString(),
      pending_norm: l.state.pending_norm.toString(),
      loss_index: l.state.loss_index.toString(),
      loss_index_after_observe: o.loss_index.toString(),
      per_share_raw: { num: ps.num.toString(), den: ps.den.toString() },
      unobserved_shortfall_raw: o.shortfall.toString(),
      unobserved_surplus_raw: o.surplus.toString(),
    };
  }

  warnings(b: BasketView, vals: any): string[] {
    const w: string[] = [];
    if (b.source === "standin") w.push("Basket source is the stand-in basket, not the basket program (see basket_source).");
    for (const l of vals.last_trade.legs) if (l.age_s !== null && l.age_s > LAST_TRADE_WARN_S) w.push(`${l.symbol} last trade is ${Math.round(l.age_s / 60)} min old`);
    for (const u of vals.sell_now.unquotable_legs) {
      const upstream = /HTTP (429|5\d\d)|fetch failed|timeout/i.test(u.reason);
      w.push(upstream ? `${u.symbol} sell quote unavailable (upstream error: ${u.reason.slice(-40)}); valued at 0 in sell_now, not interpolated` : `${u.symbol} has no sell route; valued at 0 in sell_now`);
    }
    for (const l of b.legs) {
      if (l.status === "unavailable") w.push(`${l.symbol} is unavailable (${l.unavailable_reason}); redemptions turn it into a claim, deposits are refused`);
      if (l.multiplier.pending) w.push(`${l.symbol} fixture multiplier changes to ${l.multiplier.pending.multiplier} at ${l.multiplier.pending.effective_at}`);
      if (l.fee.pending) w.push(`${l.symbol} fixture fee changes to ${l.fee.pending.bps} bps at ${this.cfg.cluster} epoch ${l.fee.pending.effective_epoch}`);
      const o = observe(l.state);
      if (o.shortfall > 0n) w.push(`${l.symbol} vault holds ${o.shortfall} raw less than accounted: unobserved shortfall (seizure or other outflow)`);
    }
    return w;
  }

  // ---------- endpoints ----------

  /** includeBuilds: attach each sell_now leg's full Jupiter /build response (for verify/sell-sim.ts). */
  async getBasket(opts: { includeBuilds?: boolean; fresh?: boolean } = {}) {
    const b = await this.basket();
    const one = 10n ** BigInt(b.share_decimals);
    const amounts = b.legs.map((l) => (l.status === "retired" ? 0n : entitlement(l.state, b.supply, one)));
    const vals = await this.values(b, amounts, { claimed: b.legs.map((l) => l.status === "unavailable"), includeBuilds: opts.includeBuilds, fresh: opts.fresh });
    const blockTime = await this.rpc.blockTime(b.slot).catch(() => null);
    const shortfallEvents = (this.watcher?.events() ?? []).filter((e) => e.kind === "program" && e.type === "ShortfallObserved");
    const ltTotal = Number(vals.last_trade.usd);
    const n = b.legs.filter((l) => l.status !== "retired").length;
    return {
      cluster: b.cluster,
      program: b.program,
      basket: b.basket,
      basket_source: this.basketSourceNote(b),
      as_of_slot: b.slot,
      as_of: { slot: b.slot, block_time: blockTime ? new Date(blockTime * 1000).toISOString().replace(".000Z", "Z") : null, epoch: b.epoch, mainnet_slot: vals.mainnet_slot, generated_at: nowIso() },
      pricing_basis: this.pricingBasis(),
      share: { mint: b.share_mint, decimals: b.share_decimals, supply_raw: b.supply.toString(), source: `${b.cluster} getMultipleAccounts`, as_of_slot: b.slot },
      legs: b.legs.map((l) => {
        const raw = this.legRaw(b, l);
        const ev = shortfallEvents.filter((e) => e.data?.leg === l.index);
        const observed = ev.reduce((s, e) => s + (BigInt(e.data.expected) - BigInt(e.data.actual)), 0n);
        // One whole share = 10^share_decimals raw share units.
        const perShareUi = ((Number(raw.per_share_raw.num) / Number(raw.per_share_raw.den || "1")) * 10 ** b.share_decimals) / 10 ** l.decimals;
        return {
          index: l.index, symbol: l.symbol, fixture_mint: l.fixture_mint, mirror_of: l.mirror_of, vault: l.vault,
          status: l.status, unavailable_reason: l.unavailable_reason, listing: l.listing,
          ...raw,
          per_share_ui: {
            value: (perShareUi * Number(l.multiplier.effective)).toPrecision(12),
            note: "display only, per whole share: per_share_raw x 10^share_decimals / 10^leg_decimals x effective multiplier of the fixture mint",
          },
          multiplier: { stored: l.multiplier.stored, effective: l.multiplier.effective, effective_since: l.multiplier.effective_since, pending: l.multiplier.pending, source: `${b.cluster} fixture mint scaledUiAmountConfig`, as_of_slot: b.slot },
          fee: { now_bps: l.fee.now_bps, pending: l.fee.pending, epoch: b.epoch, source: `${b.cluster} fixture mint transferFeeConfig`, as_of_slot: b.slot },
          shortfall: {
            since_inception_raw: (observed + BigInt(raw.unobserved_shortfall_raw)).toString(),
            observed_raw: observed.toString(),
            unobserved_raw: raw.unobserved_shortfall_raw,
            last_event_slot: ev.length ? Math.max(...ev.map((e) => e.slot)) : null,
          },
          source: `${b.cluster} ${b.source === "program" ? "Basket account + vault" : "stand-in state + vault"}`,
          as_of_slot: b.slot,
        };
      }),
      values: { sell_now: vals.sell_now, last_trade: vals.last_trade, reference: vals.reference, gaps: vals.gaps },
      weights: {
        inception: b.legs.map((l) => ({ index: l.index, value_share: l.status === "retired" ? "0" : (1 / n).toFixed(6), source: "spec 01 bootstrap: equal weight by value" })),
        current_last_trade: vals.last_trade.legs.map((x: any) => ({ index: x.index, value_share: ltTotal ? (Number(x.usd) / ltTotal).toFixed(6) : null })),
      },
      warnings: this.warnings(b, vals),
    };
  }

  async quoteRedeem(sharesRaw: bigint, mode: "in_kind" | "usdc") {
    const b = await this.basket();
    if (sharesRaw <= 0n || sharesRaw > b.supply) throw Object.assign(new Error(`shares must be in 1..${b.supply}`), { status: 400 });
    const q = quoteRedeem(b.legs.map((l) => l.state), b.supply, sharesRaw, mode);
    // What is sold, per leg: in kind, the recipient sells what they receive (net of the vault->user fee);
    // USDC mode, the vault sells the gross amount (one fee hop); a claim is valued at its entitlement now.
    const toSell = b.legs.map((l) => {
      const x = q.find((y) => y.index === l.index);
      if (!x) return 0n;
      if (x.action === "pay") return x.net_raw;
      if (x.action === "pending_sale") return x.gross_raw_if_settled_now;
      return entitlement(l.state, b.supply, x.units);
    });
    const vals = await this.values(b, toSell, { claimed: b.legs.map((l) => q.find((y) => y.index === l.index)?.action === "claim") });
    const sellBy = new Map(vals.sell_now.legs.map((x: any) => [x.index, x]));
    let paidNow = 0, claims = 0;
    const legs = q.map((x) => {
      const s: any = sellBy.get(x.index);
      const v = s ? Number(s.usd) : 0;
      const l = b.legs[x.index];
      if (x.action === "claim") {
        claims += v;
        return { index: x.index, symbol: l.symbol, action: "claim", units: x.units.toString(), reason: x.reason, entitlement_now_raw: toSell[x.index].toString(), sell_now_usd: usd(v),
          note: "Paid in kind after the leg is available again; shares the leg's gains and losses until then." };
      }
      paidNow += v;
      if (x.action === "pay") return { index: x.index, symbol: l.symbol, action: "pay", gross_raw: x.gross_raw.toString(), fee_raw: x.fee_raw.toString(), net_raw: x.net_raw.toString(), fee_bps: l.fee.now_bps, sell_now_usd: usd(v), sell_route: s?.route ?? null };
      return { index: x.index, symbol: l.symbol, action: "pending_sale", units: x.units.toString(), gross_raw: x.gross_raw_if_settled_now.toString(), fee_raw: x.fee_raw.toString(), sell_now_usd: usd(v), sell_route: s?.route ?? null,
        note: "USDC mode: the leg becomes a PendingSale claim of these units, sold by settle_leg_usdc for floor(units x owned / (S + C)) at settlement." };
    });
    return {
      cluster: b.cluster, basket: b.basket, basket_source: this.basketSourceNote(b), as_of_slot: b.slot, mainnet_slot: vals.mainnet_slot, epoch: b.epoch,
      shares_raw: sharesRaw.toString(), mode, supply_before_raw: b.supply.toString(),
      formula: "gross_raw = floor(shares x owned_i / (S + C_i)) after observe(i), S = supply before the burn; fee_raw = ceil(gross x fee_bps / 10000)",
      pricing_basis: this.pricingBasis(),
      legs,
      totals: { sell_now_usd_paid_now: usd(paidNow), sell_now_usd_claims: usd(claims) },
      values: { last_trade_usd: vals.last_trade.usd, reference_usd: vals.reference.usd, gaps: vals.gaps },
      unquotable_legs: vals.sell_now.unquotable_legs,
    };
  }

  async position(owner: string) {
    const b = await this.basket();
    const r = await this.rpc.call("getTokenAccountsByOwner", [owner, { mint: b.share_mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const shares = r.value.reduce((s: bigint, a: any) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
    const amounts = b.legs.map((l) => (l.status === "retired" ? 0n : entitlement(l.state, b.supply, shares)));
    const tickets = await this.tickets(b, owner);
    const vals = shares > 0n ? await this.values(b, amounts, { claimed: b.legs.map((l) => l.status === "unavailable") }) : null;
    return {
      cluster: b.cluster, owner, basket: b.basket, basket_source: this.basketSourceNote(b), as_of_slot: r.context.slot, basket_slot: b.slot,
      pricing_basis: this.pricingBasis(),
      shares_raw: shares.toString(), share_of_supply: b.supply ? (Number(shares) / Number(b.supply)).toFixed(9) : "0",
      legs: b.legs.map((l) => ({ index: l.index, symbol: l.symbol, entitlement_raw: amounts[l.index].toString(), status: l.status })),
      values: vals ? { sell_now: vals.sell_now, last_trade: vals.last_trade, reference: vals.reference, gaps: vals.gaps } : null,
      ...tickets,
    };
  }

  /** Open deposit tickets and redemption claims for an owner (program source only). */
  async tickets(b: BasketView, owner: string) {
    const idl = this.cfg.basket.idl;
    if (b.source !== "program" || !idl) return { deposit_tickets: [], claims: [], tickets_note: "stand-in basket has no tickets" };
    const find = async (name: string) => {
      const disc = accountDiscriminator(idl, name);
      const r = await this.rpc.call("getProgramAccounts", [b.program, { encoding: "base64", commitment: "confirmed", filters: [
        { memcmp: { offset: 0, bytes: bs58(disc), encoding: "base58" } },
        { memcmp: { offset: 8, bytes: b.basket } },
        { memcmp: { offset: 40, bytes: owner } },
      ] }]);
      return r.map((a: any) => ({ address: a.pubkey, data: decodeAccount(idl, name, Buffer.from(a.account.data[0], "base64")) }));
    };
    const [deps, reds] = await Promise.all([find("DepositTicket"), find("RedemptionTicket")]);
    const claims: any[] = [];
    for (const t of reds) {
      t.data.legs.forEach((x: any, i: number) => {
        if (x.kind !== "Claim") return;
        const l = b.legs[i];
        claims.push({ ticket: t.address, leg: i, symbol: l?.symbol, units: x.units, reason: x.reason.kind, entitlement_now_raw: l ? entitlement(l.state, b.supply, BigInt(x.units)).toString() : null, leg_status: l?.status });
      });
    }
    return {
      deposit_tickets: deps.map((d: any) => ({ address: d.address, nonce: d.data.nonce, usdc_in: d.data.usdc_in, landed_mask: d.data.landed_mask, expiry_slot: d.data.expiry_slot })),
      claims,
    };
  }

  async quoteDeposit(usdcRaw: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS) {
    const b = await this.basket();
    const one = 10n ** BigInt(b.share_decimals);
    const active = b.legs.filter((l) => l.status !== "retired");
    const unavailable = active.filter((l) => l.status === "unavailable");
    const perShare = b.legs.map((l) => (l.status === "retired" ? 0n : entitlement(l.state, b.supply, one)));
    const vals = await this.values(b, perShare);
    const sellBy = new Map(vals.sell_now.legs.map((x: any) => [x.index, Number(x.usd)]));
    const lt = new Map(vals.last_trade.legs.map((x: any) => [x.index, Number(x.usd)]));
    // Weight by sell_now; a leg with no quote falls back to its last-trade value (stated per leg).
    const w = active.map((l) => sellBy.get(l.index) ?? lt.get(l.index) ?? 0);
    const total = w.reduce((a, x) => a + x, 0);
    const amm = this.cfg.registry.fixture_amm;
    const usdc = this.cfg.registry.usdc;
    if (!amm?.program_id || !usdc?.mint) {
      throw Object.assign(new Error("registry has no fixture_amm.program_id or usdc.mint; run scripts/amm/seed-pools.ts for this cluster"), { status: 409 });
    }
    const usdcProgram = usdc.token_program ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const pools = active.map((l) => poolAccounts(amm.program_id, l.fixture_mint, usdc.mint, usdcProgram));
    // Pool accounts and reserves are read from chain; the LP fee comes from the pool account itself
    // (authoritative), not the registry, so a stale or partial registry can't skew the quote.
    const res = await this.rpc.accounts(pools.flatMap((p) => [p.legVault.toBase58(), p.usdcVault.toBase58()]));
    const poolAccs = await this.rpc.accounts(pools.map((p) => p.pool.toBase58()), "base64");
    const poolInfo = poolAccs.values.map((a: any) => { try { return a ? decodePool(Buffer.from(a.data[0], "base64")) : null; } catch { return null; } });
    const missing = active.filter((_l, k) => !poolInfo[k]);
    if (missing.length) {
      throw Object.assign(new Error(`no fixture_amm pool on ${b.cluster} for ${missing.map((l) => l.symbol).join(", ")} (program ${amm.program_id}); run scripts/amm/seed-pools.ts`), { status: 409 });
    }
    const seedBy = new Map((amm.pools ?? []).map((p: any) => [p.index, p]));
    const deltas: bigint[] = b.legs.map(() => 0n);
    const minDeltas: bigint[] = b.legs.map(() => 0n);
    let allocated = 0n;
    const legs = active.map((l, k) => {
      const slice = total ? BigInt(Math.floor((Number(usdcRaw) * w[k]) / total)) : 0n;
      allocated += slice;
      const legRes = BigInt(res.values[2 * k]?.data?.parsed?.info?.tokenAmount?.amount ?? "0");
      const usdcRes = BigInt(res.values[2 * k + 1]?.data?.parsed?.info?.tokenAmount?.amount ?? "0");
      const lpFee = poolInfo[k]!.fee_bps;
      const q = legRes && usdcRes && slice ? quoteSwap({ side: SIDE_BUY, amountIn: slice, legReserve: legRes, usdcReserve: usdcRes, lpFeeBps: lpFee, legFeeBps: l.fee.now_bps }) : null;
      const delta = q?.delivered ?? 0n; // lands straight in the vault, net of the leg's transfer fee
      const minOut = (delta * BigInt(10_000 - slippageBps)) / 10_000n;
      deltas[l.index] = delta;
      minDeltas[l.index] = minOut;
      const seed: any = seedBy.get(l.index);
      const poolPrice = legRes ? Number(usdcRes) / 1e6 / Number(legRes) : null;
      const mainPrice = vals.last_trade.legs.find((x: any) => x.index === l.index)?.usd_per_raw;
      return {
        index: l.index, symbol: l.symbol, usdc_raw: slice.toString(), weight: total ? (w[k] / total).toFixed(6) : null,
        weight_source: sellBy.has(l.index) ? "sell_now (one share)" : "last_trade (no sell quote)",
        expected_delta_raw: delta.toString(), min_out_raw: minOut.toString(), transfer_fee_raw: (q?.out_fee ?? 0n).toString(),
        route: {
          router: "fixture_amm", program: amm.program_id, pool: pools[k].pool.toBase58(), leg_vault: pools[k].legVault.toBase58(), usdc_vault: pools[k].usdcVault.toBase58(),
          lp_fee_bps: lpFee, lp_fee_source: "pool account (chain)", reserves: { leg_raw: legRes.toString(), usdc_raw: usdcRes.toString(), slot: res.slot },
          pool_usd_per_raw: poolPrice?.toPrecision(12) ?? null, mainnet_last_trade_usd_per_raw: mainPrice ?? null,
          pool_vs_mainnet_bps: poolPrice && mainPrice ? bps(poolPrice, Number(mainPrice)) : null,
          price_source: seed?.seed ? `pool seeded from ${seed.seed.source} at ${seed.seed.seeded_at} (blockId ${seed.seed.jupiter?.blockId ?? "?"}); swap maths = fixture_amm constant product on measured input` : "no seed record in the registry; price = current pool reserves",
          swap_accounts: "fixtures/amm/src/lib.rs `swap`: pool, leg_mint, usdc_mint, leg_vault[w], usdc_vault[w], taker[s], source[w], destination[w], token_2022, token",
        },
      };
    });
    const expectedShares = unavailable.length ? null : sharesForDeltas(b.legs.map((l) => l.state), b.supply, deltas);
    const minShares = unavailable.length ? null : sharesForDeltas(b.legs.map((l) => l.state), b.supply, minDeltas);
    const idx = active.map((l) => l.index);
    return {
      cluster: b.cluster, basket: b.basket, basket_source: this.basketSourceNote(b), as_of_slot: b.slot, pool_slot: res.slot, mainnet_slot: vals.mainnet_slot,
      usdc_raw: usdcRaw.toString(), refund_rounding_raw: (usdcRaw - allocated).toString(),
      deposit_possible: unavailable.length === 0 && b.deposits_enabled,
      refused: unavailable.length ? { error: "LegUnavailable", legs: unavailable.map((l) => ({ index: l.index, symbol: l.symbol, reason: l.unavailable_reason })) } : (!b.deposits_enabled ? { error: "DepositsDisabled" } : null),
      slippage_bps: slippageBps,
      slippage_note: "Default 150 bps below the expected delta: absorbs pool movement from other swaps between quote and landing. It does not absorb a fee step at an epoch boundary (e.g. 100 -> 300 bps): then min_out fails, the leg is retried, or the ticket refunds.",
      split_rule: "USDC per leg proportional to one share's per-leg sell_now value (spec 03)",
      pricing_basis: { ...this.pricingBasis(), devnet_routes: "On devnet the routes are fixture_amm pools, seeded from the same mainnet last_trade source (Jupiter price v3)." },
      legs,
      expected_shares_raw: expectedShares?.toString() ?? null,
      min_shares_raw: minShares?.toString() ?? null,
      shares_formula: "min over active legs of floor(delta_i x (S + C_i) / owned_i), owned before the deposit (spec 01)",
      packing: depositPacking(idx),
    };
  }

  async capacity(maxRoundTripBps: number) {
    const b = await this.basket();
    const legs = b.legs.filter((l) => l.status !== "retired");
    const ladder = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
    return this.cache.get(`cap:${maxRoundTripBps}`, 600_000, async () => {
      const out: any[] = [];
      for (const l of legs) {
        let best = 0;
        const steps: any[] = [];
        for (const size of ladder) {
          const rt = await roundTrip(l.mirror_of, size).catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
          steps.push({ usd: size, ...rt });
          if ("round_trip_bps" in rt && rt.round_trip_bps <= maxRoundTripBps) best = size; else break;
        }
        out.push({ index: l.index, symbol: l.symbol, max_usd_per_leg: best, ladder: steps });
      }
      const perLeg = Math.min(...out.map((x) => x.max_usd_per_leg));
      return {
        max_round_trip_bps: maxRoundTripBps, computed_at: nowIso(), pricing_basis: this.pricingBasis(),
        method: `buy USDC->token then sell the received token->USDC on mainnet (Jupiter swap/v1 quote, excludeDexes=${EXCLUDE_DEXES}, fee-inclusive); round trip = 1 - usdc_back / usdc_in; largest ladder step under the threshold`,
        legs: out, per_leg_usd: perLeg, per_basket_usd: perLeg * legs.length,
        note: "per-basket capacity assumes equal value per leg (spec 01); the thinnest leg binds",
      };
    });
  }

  async issuer() {
    const b = await this.basket();
    const mints = b.legs.map((l) => l.mirror_of);
    const [mm, ms] = await Promise.all([this.mainnet.accounts(mints), this.mainnet.account(PRESTOCKS_MULTISIG, "base64")]);
    const mEpoch = await this.mainnet.epochInfo();
    const now = Math.floor(Date.now() / 1000);
    const multisig = ms.value ? decodeMultisig(PRESTOCKS_MULTISIG, Buffer.from(ms.value.data[0], "base64")) : null;
    return {
      as_of: { fixture_cluster: b.cluster, fixture_slot: b.slot, fixture_epoch: b.epoch, mainnet_slot: mm.slot, mainnet_epoch: mEpoch.epoch, generated_at: nowIso() },
      controllers: {
        mainnet: multisig ? { kind: "Squads v4 multisig", address: PRESTOCKS_MULTISIG, vault: multisig.vault_index0, threshold: multisig.threshold, members: multisig.members.length, voters: multisig.voters, time_lock_s: multisig.time_lock_s, config_authority: multisig.config_authority, transaction_index: multisig.transaction_index, source: `mainnet account ${PRESTOCKS_MULTISIG}`, as_of_slot: ms.slot } : null,
        fixture: { kind: "single key (devnet stand-in for the 2-of-7 multisig)", address: this.cfg.registry.fixture_issuer, threshold: 1, members: 1, time_lock_s: 0 },
      },
      legs: b.legs.map((l, i) => ({
        index: l.index, symbol: l.symbol,
        fixture: { mint: l.fixture_mint, ...controlsView(issuerControls(l.mint_info, b.epoch, now)), source: `${b.cluster} mint account`, as_of_slot: b.slot },
        mainnet: mm.values[i] ? { mint: l.mirror_of, ...controlsView(issuerControls(mm.values[i].data.parsed.info, mEpoch.epoch, now)), source: "mainnet mint account", as_of_slot: mm.slot } : null,
      })),
    };
  }

  events(q: { since_slot?: number; since_mainnet_slot?: number }) {
    const w = this.watcher;
    return {
      as_of: { generated_at: nowIso(), last_poll: w?.lastPoll ?? null },
      watching: w ? w.targets.map((t) => ({ cluster: t.cluster, authority: t.authority, multisig: t.multisig ?? null, mints: t.mints.length })) : [],
      program_events: w?.program ? { program: w.program.programId, basket: w.program.basket } : "basket program not on this cluster yet (stand-in source)",
      filter: q,
      events: w ? w.events(q) : [],
      errors: w?.errors ?? [],
    };
  }
}

function controlsView(c: ReturnType<typeof issuerControls>) {
  return {
    fee_bps_now: c.fee?.now_bps ?? null,
    fee_pending: c.fee?.pending ?? null,
    fee_schedule: c.fee ? { older: c.fee.older, newer: c.fee.newer, epoch: c.fee.epoch } : null,
    paused: c.paused,
    hook_program: c.hook_program,
    default_account_state: c.default_account_state,
    permanent_delegate: c.permanent_delegate,
    multiplier: { stored: c.multiplier.stored, effective: c.multiplier.effective, effective_since: c.multiplier.effective_since, pending: c.multiplier.pending },
    authorities: { mint: c.mint_authority, freeze: c.freeze_authority, fee_config: c.fee_config_authority, withdraw_withheld: c.withdraw_withheld_authority, pause: c.pause_authority, hook: c.hook_authority, multiplier: c.multiplier_authority },
    supply_raw: c.supply_raw,
  };
}

/**
 * Deposit packing per spec 02 Budgets (A's fork run, program 700004c): at most 3 legs per transaction,
 * 2 when a leg is 2-hop or shares the transaction with open_deposit_ticket; finalize separately.
 * fixture_amm routes are single-hop. A full 7-leg deposit is 4 transactions. B's SDK still packs by
 * serialized bytes and account locks (64) and has the final say; this is the plan, not a measurement.
 */
function depositPacking(legs: number[], hops: Record<number, number> = {}) {
  const txs: { kind: string; legs: number[] }[] = [];
  let i = 0;
  const cap = (first: boolean, next: number[]) => (first || next.some((l) => (hops[l] ?? 1) > 1) ? 2 : 3);
  let first = true;
  while (i < legs.length) {
    let n = cap(first, legs.slice(i, i + 3));
    if (!first && legs.slice(i, i + n).some((l) => (hops[l] ?? 1) > 1)) n = 2;
    txs.push({ kind: first ? "open_deposit_ticket + ticket_swap_leg" : "ticket_swap_leg", legs: legs.slice(i, i + n) });
    i += n;
    first = false;
  }
  txs.push({ kind: "finalize_deposit", legs: [] });
  return {
    rule: "spec 02 Budgets: <= 3 legs per transaction; 2 when a leg is 2-hop or shares the transaction with open; finalize separate",
    route_hops: "fixture_amm: 1 hop per leg",
    transactions: txs,
    transaction_count: txs.length,
    note: "B's SDK packs by serialized bytes and the 64 account-lock limit and has the final say.",
  };
}


const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(buf: Buffer): string {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}

/** Mainnet round trip at `usd` size: USDC -> token -> USDC, both legs fee-inclusive quotes. */
async function roundTrip(mint: string, usdSize: number) {
  const base = process.env.JUP_QUOTE_URL ?? "https://lite-api.jup.ag/swap/v1/quote";
  const usdcIn = BigInt(Math.round(usdSize * 1e6));
  const get = async (i: string, o: string, amt: bigint) => {
    const r = await fetch(`${base}?inputMint=${i}&outputMint=${o}&amount=${amt}&slippageBps=100&excludeDexes=${EXCLUDE_DEXES}`, { signal: AbortSignal.timeout(20_000) });
    const j: any = await r.json();
    if (!r.ok || !j.outAmount) throw new Error(`quote ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
    return BigInt(j.outAmount);
  };
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const tokens = await get(USDC, mint, usdcIn);
  const back = await get(mint, USDC, tokens);
  return { tokens_raw: tokens.toString(), usdc_back_raw: back.toString(), round_trip_bps: Math.round((1 - Number(back) / Number(usdcIn)) * 10_000) };
}

