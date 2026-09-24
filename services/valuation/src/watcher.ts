// Issuer-change watcher and program-event poller (spec 03, /v1/events).
//
// Issuer events, per cluster (mainnet PreStocks mints; devnet/local fixture mints):
//  1. Transaction scan of the issuer AUTHORITY (mainnet: the Squads vault WV9P…; fixtures: the fixture
//     issuer). Every Token-2022 issuer instruction on a watched mint, outer or inner (Squads executes
//     inner), becomes one event with its signature and slot. Far fewer transactions than the mints'.
//  2. State diff of the mints on every poll. A change no scanned transaction explains is still emitted,
//     with `signature: null` and the slot it was detected at, so a missed transaction can't hide it.
//  3. The Squads multisig account (mainnet): threshold, members, time lock → MultisigConfigChanged.
// Before/after: "after" comes from the instruction's own arguments; "before" is the last state the
// watcher knew for that mint (from its previous snapshot or earlier event), or null if unknown.
//
// Program events: Anchor events from the basket program's transactions (IDL-decoded), when the basket
// source is the program.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { Rpc } from "./lib/rpc.ts";
import { issuerControls, TOKEN_2022_PROGRAM } from "./lib/token2022.ts";
import { decodeMultisig } from "./lib/squads.ts";
import { decodeEvents } from "./lib/idl.ts";
import type { Idl } from "./lib/idl.ts";

export interface WatchTarget {
  cluster: string; // mainnet | devnet | local
  rpc: Rpc;
  mints: { mint: string; symbol: string; index: number }[];
  authority: string;
  multisig?: string;
  backfill: number; // how many authority transactions to scan on first run
}

export interface IssuerEvent {
  id: string;
  kind: "issuer" | "program";
  type: string;
  cluster: string;
  mint?: string;
  symbol?: string;
  leg?: number;
  before?: any;
  after?: any;
  data?: any;
  signature: string | null;
  slot: number;
  block_time: number | null;
  block_time_iso: string | null;
  detected_by: "transaction" | "state-diff" | "program-log";
  source: string;
}

const ISSUER_TYPES = new Set([
  "setTransferFee", "updateMultiplier", "pause", "resume", "updateTransferHook", "updateDefaultAccountState",
  "freezeAccount", "thawAccount", "setAuthority", "burn", "burnChecked", "transfer", "transferChecked",
]);
const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString().replace(".000Z", "Z") : null);

interface Store {
  events: IssuerEvent[];
  cursors: Record<string, string | null>; // `${cluster}:${address}` -> newest processed signature
  snapshots: Record<string, any>; // `${cluster}:${mint}` -> comparable controls
  multisig: Record<string, any>;
}

export class Watcher {
  path: string;
  store: Store;
  targets: WatchTarget[];
  program?: { cluster: string; rpc: Rpc; programId: string; basket: string; idl: Idl };
  epochSchedules: Record<string, any> = {};
  lastPoll: Record<string, { at: string; slot: number } | null> = {};
  errors: string[] = [];

  constructor(path: string, targets: WatchTarget[]) {
    this.path = path;
    this.targets = targets;
    this.store = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { events: [], cursors: {}, snapshots: {}, multisig: {} };
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + ".tmp", JSON.stringify(this.store, null, 1));
    renameSync(this.path + ".tmp", this.path);
  }

  private add(e: Omit<IssuerEvent, "id">) {
    const id = `${e.cluster}:${e.signature ?? "diff@" + e.slot}:${e.mint ?? ""}:${e.type}:${JSON.stringify(e.after ?? e.data ?? null)}`;
    if (this.store.events.some((x) => x.id === id)) return false;
    this.store.events.push({ id, ...e });
    return true;
  }

  private async epochOf(t: WatchTarget | { cluster: string; rpc: Rpc }, slot: number): Promise<number> {
    let s = this.epochSchedules[t.cluster];
    if (!s) s = this.epochSchedules[t.cluster] = await t.rpc.call("getEpochSchedule", []);
    if (slot < s.firstNormalSlot) {
      // Warmup epochs double in length from MINIMUM_SLOTS_PER_EPOCH (32).
      let e = 0, start = 0, len = 32;
      while (start + len <= slot) { start += len; len *= 2; e++; }
      return e;
    }
    return s.firstNormalEpoch + Math.floor((slot - s.firstNormalSlot) / s.slotsPerEpoch);
  }

  /** Comparable per-mint controls (what a change is detected on). */
  private comparable(info: any, epoch: number) {
    const c = issuerControls(info, epoch, Math.floor(Date.now() / 1000));
    return {
      fee_newer: c.fee ? { bps: c.fee.newer.bps, epoch: c.fee.newer.epoch, maximum_fee: c.fee.newer.maximum_fee } : null,
      fee_older: c.fee ? { bps: c.fee.older.bps, epoch: c.fee.older.epoch } : null,
      paused: c.paused,
      hook_program: c.hook_program,
      default_account_state: c.default_account_state,
      multiplier: { stored: c.multiplier.stored, new: c.multiplier.new_multiplier, effective_ts: c.multiplier.new_multiplier_effective_ts },
      authorities: {
        mint: c.mint_authority, freeze: c.freeze_authority, permanent_delegate: c.permanent_delegate, fee_config: c.fee_config_authority,
        withdraw_withheld: c.withdraw_withheld_authority, pause: c.pause_authority, hook: c.hook_authority, multiplier: c.multiplier_authority,
      },
    };
  }

  /** Scan the authority's transactions since the cursor and emit one event per issuer instruction. */
  private async scanAuthority(t: WatchTarget) {
    const key = `${t.cluster}:${t.authority}`;
    const until = this.store.cursors[key] ?? undefined;
    const sigs: any[] = [];
    let before: string | undefined;
    const cap = until ? 1000 : t.backfill;
    while (sigs.length < cap) {
      const page = await t.rpc.signaturesFor(t.authority, { limit: Math.min(100, cap - sigs.length), ...(until ? { until } : {}), ...(before ? { before } : {}) });
      if (!page.length) break;
      sigs.push(...page);
      before = page[page.length - 1].signature;
      if (page.length < 100) break;
    }
    if (!sigs.length) return;
    const byMint = new Map(t.mints.map((m) => [m.mint, m]));
    // Backfill (no cursor yet): "before" is built from the history itself, oldest first, starting unknown.
    // Live: "before" is the snapshot from the previous poll, advanced by each instruction.
    const hist: Record<string, any> = {};
    const stateFor = (mint: string) => (until ? (this.store.snapshots[`${t.cluster}:${mint}`] ??= {}) : (hist[mint] ??= {}));
    for (const s of sigs.reverse()) {
      if (s.err) continue;
      const tx = await t.rpc.transaction(s.signature).catch(() => null);
      if (!tx) continue;
      const ixs: any[] = [...tx.transaction.message.instructions];
      for (const g of tx.meta?.innerInstructions ?? []) ixs.push(...g.instructions);
      for (const ix of ixs) {
        if (ix.programId !== TOKEN_2022_PROGRAM || !ix.parsed || !ISSUER_TYPES.has(ix.parsed.type)) continue;
        const info = ix.parsed.info ?? {};
        const m = byMint.get(info.mint);
        if (!m) continue;
        await this.instructionEvent(t, m, ix.parsed.type, info, tx, s.signature, stateFor(m.mint));
      }
    }
    this.store.cursors[key] = sigs[sigs.length - 1].signature;
  }

  private async instructionEvent(t: WatchTarget, m: { mint: string; symbol: string; index: number }, type: string, info: any, tx: any, sig: string, prev: any) {
    const known = (k: string) => prev && prev[k] !== undefined;
    const base = { kind: "issuer" as const, cluster: t.cluster, mint: m.mint, symbol: m.symbol, leg: m.index, signature: sig, slot: tx.slot, block_time: tx.blockTime ?? null, block_time_iso: iso(tx.blockTime ?? null), detected_by: "transaction" as const, source: `${t.cluster} getTransaction (jsonParsed) of issuer authority ${t.authority}` };
    const owners = (bal: any[]) => Object.fromEntries((bal ?? []).map((b: any) => [tx.transaction.message.accountKeys[b.accountIndex]?.pubkey, b.owner]));
    switch (type) {
      case "setTransferFee": {
        const epoch = await this.epochOf(t, tx.slot);
        const after = { bps: info.transferFeeBasisPoints, maximum_fee: String(info.maximumFee), effective_epoch: epoch + 2 };
        this.add({ ...base, type: "FeeChangeScheduled", before: prev?.fee_newer ? { bps: prev.fee_newer.bps, effective_epoch: prev.fee_newer.epoch } : null, after });
        prev.fee_newer = { bps: after.bps, epoch: after.effective_epoch, maximum_fee: after.maximum_fee };
        break;
      }
      case "updateMultiplier": {
        const ts = Number(info.newMultiplierTimestamp);
        const after = { multiplier: String(info.newMultiplier), effective_ts: ts, effective_at: iso(ts) };
        this.add({ ...base, type: "MultiplierChangeScheduled", before: prev?.multiplier ? { multiplier: prev.multiplier.new, effective_ts: prev.multiplier.effective_ts } : null, after });
        prev.multiplier = { ...(prev.multiplier ?? {}), new: after.multiplier, effective_ts: ts };
        break;
      }
      case "pause":
      case "resume":
        this.add({ ...base, type: type === "pause" ? "Paused" : "Resumed", before: known("paused") ? { paused: prev.paused } : null, after: { paused: type === "pause" } });
        prev.paused = type === "pause";
        break;
      case "updateTransferHook":
        this.add({ ...base, type: "HookSet", before: known("hook_program") ? { program_id: prev.hook_program } : null, after: { program_id: info.programId ?? null } });
        prev.hook_program = info.programId ?? null;
        break;
      case "updateDefaultAccountState":
        this.add({ ...base, type: "DefaultStateChanged", before: known("default_account_state") ? { state: prev.default_account_state } : null, after: { state: info.accountState } });
        prev.default_account_state = info.accountState;
        break;
      case "freezeAccount":
      case "thawAccount":
        this.add({ ...base, type: type === "freezeAccount" ? "AccountFrozen" : "AccountThawed", after: { account: info.account, owner: owners(tx.meta?.preTokenBalances)[info.account] ?? null } });
        break;
      case "setAuthority":
        this.add({ ...base, type: "AuthorityChanged", after: { authority_type: info.authorityType, new_authority: info.newAuthority ?? null } });
        break;
      case "burn":
      case "burnChecked":
      case "transfer":
      case "transferChecked": {
        // Only the permanent delegate acting on someone else's account is an issuer action (a seizure).
        const src = info.account ?? info.source;
        const owner = owners(tx.meta?.preTokenBalances)[src];
        const auth = info.authority ?? info.multisigAuthority;
        const delegate = prev?.authorities?.permanent_delegate ?? t.authority;
        if (auth !== delegate || !owner || owner === auth) break;
        this.add({ ...base, type: "PermanentDelegateSeizure", after: { account: src, owner, via: type, amount_raw: info.tokenAmount?.amount ?? String(info.amount ?? ""), destination: info.destination ?? null } });
        break;
      }
    }
  }

  /** Diff the mints' state against the last snapshot; emit what no transaction explained. */
  private async diffMints(t: WatchTarget) {
    const [r, ep] = await Promise.all([t.rpc.accounts(t.mints.map((m) => m.mint)), t.rpc.epochInfo()]);
    const bt = await t.rpc.blockTime(r.slot).catch(() => null);
    t.mints.forEach((m, i) => {
      const info = r.values[i]?.data?.parsed?.info;
      if (!info) return;
      const cur = this.comparable(info, ep.epoch);
      const key = `${t.cluster}:${m.mint}`;
      const prev = this.store.snapshots[key];
      const base = { kind: "issuer" as const, cluster: t.cluster, mint: m.mint, symbol: m.symbol, leg: m.index, signature: null, slot: r.slot, block_time: bt, block_time_iso: iso(bt), detected_by: "state-diff" as const, source: `${t.cluster} getMultipleAccounts (jsonParsed)` };
      // A change already reported by a scanned transaction since the previous snapshot is not repeated.
      const add = (e: any) => {
        const explained = this.store.events.some((x) => x.cluster === t.cluster && x.mint === m.mint && x.type === e.type && x.detected_by === "transaction" && x.slot > (prev?._slot ?? 0));
        if (!explained) this.add(e);
      };
      if (prev && prev._slot !== undefined) {
        const j = JSON.stringify;
        if (j(prev.fee_newer) !== j(cur.fee_newer)) add({ ...base, type: "FeeChangeScheduled", before: prev.fee_newer, after: cur.fee_newer });
        if (j(prev.multiplier.new) !== j(cur.multiplier.new) || prev.multiplier.effective_ts !== cur.multiplier.effective_ts) add({ ...base, type: "MultiplierChangeScheduled", before: prev.multiplier, after: cur.multiplier });
        if (prev.paused !== cur.paused) add({ ...base, type: cur.paused ? "Paused" : "Resumed", before: { paused: prev.paused }, after: { paused: cur.paused } });
        if (prev.hook_program !== cur.hook_program) add({ ...base, type: "HookSet", before: { program_id: prev.hook_program }, after: { program_id: cur.hook_program } });
        if (prev.default_account_state !== cur.default_account_state) add({ ...base, type: "DefaultStateChanged", before: { state: prev.default_account_state }, after: { state: cur.default_account_state } });
        if (j(prev.authorities) !== j(cur.authorities)) add({ ...base, type: "AuthorityChanged", before: prev.authorities, after: cur.authorities });
      }
      this.store.snapshots[key] = { ...cur, _slot: r.slot };
    });
    this.lastPoll[t.cluster] = { at: new Date().toISOString(), slot: r.slot };
  }

  private async diffMultisig(t: WatchTarget) {
    if (!t.multisig) return;
    const r = await t.rpc.account(t.multisig, "base64");
    if (!r.value) return;
    const v = decodeMultisig(t.multisig, Buffer.from(r.value.data[0], "base64"));
    const cur = { threshold: v.threshold, time_lock_s: v.time_lock_s, members: v.members, config_authority: v.config_authority };
    const prev = this.store.multisig[t.multisig];
    if (prev && JSON.stringify(prev) !== JSON.stringify(cur)) {
      const bt = await t.rpc.blockTime(r.slot).catch(() => null);
      this.add({ kind: "issuer", type: "MultisigConfigChanged", cluster: t.cluster, before: prev, after: cur, signature: null, slot: r.slot, block_time: bt, block_time_iso: iso(bt), detected_by: "state-diff", source: `${t.cluster} Squads v4 multisig ${t.multisig}` });
    }
    this.store.multisig[t.multisig] = cur;
  }

  private async pollProgram() {
    const p = this.program;
    if (!p) return;
    const key = `${p.cluster}:${p.basket}`;
    const until = this.store.cursors[key] ?? undefined;
    const sigs = await p.rpc.signaturesFor(p.basket, { limit: 200, ...(until ? { until } : {}) });
    for (const s of sigs.reverse()) {
      if (s.err) continue;
      const tx = await p.rpc.transaction(s.signature).catch(() => null);
      if (!tx) continue;
      for (const ev of decodeEvents(p.idl, tx.meta?.logMessages ?? [], p.programId)) {
        this.add({ kind: "program", type: ev.name, cluster: p.cluster, data: ev.data, leg: ev.data.leg, signature: s.signature, slot: tx.slot, block_time: tx.blockTime ?? null, block_time_iso: iso(tx.blockTime ?? null), detected_by: "program-log", source: `${p.cluster} basket program ${p.programId} logs (IDL-decoded)` });
      }
    }
    if (sigs.length) this.store.cursors[key] = sigs[sigs.length - 1].signature;
  }

  async pollOnce() {
    for (const t of this.targets) {
      try {
        // Snapshot first on the very first run so "before" values exist for scanned instructions.
        if (!t.mints.every((m) => this.store.snapshots[`${t.cluster}:${m.mint}`])) await this.diffMints(t);
        await this.scanAuthority(t);
        await this.diffMints(t);
        await this.diffMultisig(t);
      } catch (e: any) {
        this.errors.push(`${new Date().toISOString()} ${t.cluster}: ${e?.message ?? e}`);
        this.errors = this.errors.slice(-20);
      }
    }
    try { await this.pollProgram(); } catch (e: any) { this.errors.push(`program: ${e?.message ?? e}`); }
    this.save();
  }

  events(filter: { since_slot?: number; since_mainnet_slot?: number } = {}) {
    return this.store.events
      .filter((e) => (e.cluster === "mainnet" ? e.slot >= (filter.since_mainnet_slot ?? 0) : e.slot >= (filter.since_slot ?? 0)))
      .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0) || b.slot - a.slot);
  }
}
