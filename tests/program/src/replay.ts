// Replays the reference model's recorded operations (tests/program/vectors/out/*.json) against the real
// basket program in LiteSVM and compares every result and the full post-state to the unit.
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, Svm, T22, TOKEN, TxResult, kp } from "./env.ts";
import { Issuer, LEG_NAMES, Unavail, tokenAmount } from "./fixtures.ts";
import { BasketClient, INDEX_ONE } from "./basket.ts";

export const INITIAL_SHARES = 1_000_000_000n;

export const VECTORS = path.join(ROOT, "tests/program/vectors/out");

export function loadVector(test: string) {
  const f = path.join(VECTORS, `${test}.json`);
  if (!fs.existsSync(f)) throw new Error(`missing ${f}: run \`npm run vectors\` (python3 tests/program/vectors/gen_vectors.py)`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

const big = (x: any) => BigInt(x.toString());
const WEEK = 7 * 24 * 3600;

export interface ReplayStats { scenarios: number; ops: number; txs: number; compared: number; refusedMatched: number }

/** One shared LiteSVM + issuer + fixture-mint templates for all scenarios of a test file. */
export class Replayer {
  env = new Svm();
  issuer = new Issuer(this.env);
  usdc: PublicKey;
  templates = new Map<number, PublicKey[]>();
  stats: ReplayStats = { scenarios: 0, ops: 0, txs: 0, compared: 0, refusedMatched: 0 };

  constructor() {
    this.usdc = this.issuer.createUsdc();
  }

  /** Fixture mints for a fee level, created once by real Token-2022 instructions, then byte-copied per scenario. */
  template(fee: number, n: number): PublicKey[] {
    if (!this.templates.has(fee)) {
      this.templates.set(fee, LEG_NAMES.slice(0, n).map((name) => this.issuer.createLegMint(`${name}-${fee}`, fee)));
    }
    return this.templates.get(fee)!;
  }

  run(test: string, scenario: any, idx: number, mode: Unavail,
    hooks: { onOp?: (s: Scenario, op: any) => void; onBefore?: (s: Scenario, op: any) => void } = {}): Scenario {
    const s = new Scenario(this, `${test}#${idx}:${mode}`, scenario, mode);
    s.onOp = hooks.onOp;
    s.onBefore = hooks.onBefore;
    s.play();
    this.stats.scenarios++;
    this.stats.txs = this.env.txCount;
    return s;
  }
}

export class Scenario {
  r: Replayer;
  env: Svm;
  iss: Issuer;
  c!: BasketClient;
  owners = new Map<string, Keypair>();
  tickets = new Map<string, { pda: PublicKey; owner: string }>();
  claims = new Map<string, { ticket: PublicKey; owner: string; leg: number }>();
  unavailable = new Set<number>();
  n: number;
  /** Called after every op with the scenario, the op and the tx result (property checks). */
  onOp?: (s: Scenario, op: any) => void;
  onBefore?: (s: Scenario, op: any) => void;

  constructor(r: Replayer, public label: string, public scn: any, public mode: Unavail) {
    this.r = r; this.env = r.env; this.iss = r.issuer; this.n = scn.n_legs;
    const tmpl = r.template(scn.fee_bps, this.n);
    const mints = tmpl.map((t, i) => {
      const m = kp(`mint:${label}:${i}`).publicKey;
      this.iss.cloneMint(t, m);
      return m;
    });
    const seed = kp("owner:seed");
    const { client, res } = BasketClient.create(this.env, this.iss, mints, r.usdc, { label, authority: seed });
    if (!res.ok) throw new Error("init: " + res.error + res.logs.join("\n"));
    this.c = client;
  }

  owner(name: string): Keypair {
    let k = this.owners.get(name);
    if (!k) {
      k = name === "seed" ? this.c.authority : kp("owner:" + name);
      this.c.setupUser(k);
      this.owners.set(name, k);
    }
    return k;
  }

  fail(op: any, msg: string): never {
    throw new Error(`[${this.label}] op ${JSON.stringify(op.op)} ${JSON.stringify(op.args)}: ${msg}`);
  }

  // ---- issuer-side unavailability, and lifting it for issuer actions the model applies regardless ----
  makeUnavailable(i: number) {
    const m = this.c.mints[i];
    if (this.mode === "pause") this.iss.pause(m);
    else if (this.mode === "hook") this.iss.setHook(m, kp("some-hook-program").publicKey);
    else this.iss.freeze(this.c.vaults[i], m);
    this.unavailable.add(i);
  }
  makeAvailable(i: number) {
    const m = this.c.mints[i];
    if (this.mode === "pause") this.iss.resume(m);
    else if (this.mode === "hook") this.iss.setHook(m, PublicKey.default);
    else this.iss.thaw(this.c.vaults[i], m);
    this.unavailable.delete(i);
  }
  /** Run an issuer action on leg i as if it were available (pause blocks mint/burn; freeze blocks the vault). */
  lifted(i: number, touchesVault: boolean, f: () => void) {
    const lift = this.unavailable.has(i) && (this.mode === "pause" || (this.mode === "freeze" && touchesVault));
    if (lift) this.makeAvailable(i);
    f();
    if (lift) this.makeUnavailable(i);
  }

  premint(owner: Keypair, gross: bigint[]) {
    for (let i = 0; i < this.n; i++) {
      if (gross[i] > 0n) this.lifted(i, false, () => this.iss.mintTo(this.c.mints[i], this.c.userAta(owner.publicKey, this.c.mints[i]), gross[i]));
    }
  }

  expectOutcome(op: any, res: TxResult) {
    if (op.refused) {
      if (res.ok) this.fail(op, `model refused (${op.refused}) but the program accepted`);
      if (res.error !== op.refused) this.fail(op, `model refused ${op.refused}, program failed with ${res.error}`);
      this.r.stats.refusedMatched++;
      return false;
    }
    if (!res.ok) this.fail(op, `program failed: ${res.error}\n${res.logs.slice(-12).join("\n")}`);
    return true;
  }

  compareEvents(op: any, res: TxResult) {
    const want = (op.events ?? []).filter((e: any[]) => ["ShortfallObserved", "SurplusObserved", "ClaimCreated", "LegConverted"].includes(e[0]))
      .map((e: any[]) => {
        if (e[0] === "ShortfallObserved" || e[0] === "SurplusObserved") return `${e[0]}:${e[1]}:${e[2]}:${e[3]}`;
        if (e[0] === "ClaimCreated") return `ClaimCreated:${e[2]}:${e[3]}`;
        return `LegConverted:${e[1]}:${e[2]}:${e[3]}`;
      });
    const got = res.events.filter((e) => ["ShortfallObserved", "SurplusObserved", "ClaimCreated", "LegConverted"].includes(e.name))
      .map((e) => {
        const d = e.data;
        if (e.name === "ShortfallObserved" || e.name === "SurplusObserved") return `${e.name}:${d.leg}:${big(d.expected)}:${big(d.actual)}`;
        if (e.name === "ClaimCreated") return `ClaimCreated:${d.leg}:${big(d.units)}`;
        return `LegConverted:${d.leg}:${big(d.amount)}:${big(d.usdc)}`;
      });
    if (JSON.stringify(want) !== JSON.stringify(got)) this.fail(op, `events differ\n model: ${want.join(" ")}\n chain: ${got.join(" ")}`);
  }

  compareState(op: any) {
    const st = op.state;
    if (!st) return;
    const legs = this.c.legs();
    const d: string[] = [];
    for (let i = 0; i < this.n; i++) {
      const m = st.legs[i], l = legs[i];
      const chk = (k: string, a: bigint, b: bigint) => { if (a !== b) d.push(`leg ${i} ${k}: model ${a} chain ${b}`); };
      chk("balance", big(m.balance), this.c.balance(i));
      chk("accounted", big(m.accounted), l.accounted);
      chk("claim_units", big(m.claim_units), l.claimUnits);
      chk("pending_norm", big(m.pending_norm), l.pendingNorm);
      chk("loss_index", big(m.loss_index), l.lossIndex);
      if (m.retired !== (l.status === "Retired")) d.push(`leg ${i} retired: model ${m.retired} chain ${l.status}`);
    }
    if (big(st.supply) !== this.c.supply()) d.push(`supply: model ${st.supply} chain ${this.c.supply()}`);
    for (const [o, s] of Object.entries(st.shares)) {
      const got = this.c.shares(this.owner(o).publicKey);
      if (big(s) !== got) d.push(`shares[${o}]: model ${s} chain ${got}`);
    }
    const res = tokenAmount(this.env, this.c.reserve);
    if (big(st.usdc_reserve) !== res) d.push(`usdc_reserve: model ${st.usdc_reserve} chain ${res}`);
    if (d.length) this.fail(op, "state differs:\n  " + d.join("\n  "));
    this.r.stats.compared++;
  }

  play() {
    for (const op of this.scn.ops) {
      this.onBefore?.(this, op);
      this.apply(op);
      this.compareState(op);
      this.onOp?.(this, op);
      this.r.stats.ops++;
    }
  }

  apply(op: any) {
    const a = op.args;
    const c = this.c;
    switch (op.op) {
      case "bootstrap": {
        const o = this.owner(a.owner);
        if (big(a.initial_shares) !== INITIAL_SHARES) {
          this.fail(op, `the model bootstraps ${a.initial_shares} shares; the program always mints INITIAL_SHARES = ${INITIAL_SHARES} (spec 02). Replay the __initial_shares_1e9 variant.`);
        }
        const gross = a.gross.map(big);
        this.premint(o, gross);
        const res = c.bootstrap(gross, o);
        if (this.expectOutcome(op, res)) {
          if (c.shares(o.publicKey) !== big(op.result)) this.fail(op, "bootstrap shares");
          op.chain = c.shares(o.publicKey);
          this.compareEvents(op, res);
        }
        return;
      }
      case "mint_in_kind": {
        const o = this.owner(a.owner);
        const gross = a.gross.map(big);
        this.premint(o, gross);
        const before = c.shares(o.publicKey);
        const res = c.depositInKind(o, gross, big(a.min_shares));
        if (this.expectOutcome(op, res)) {
          const got = c.shares(o.publicKey) - before;
          if (got !== big(op.result)) this.fail(op, `shares minted: model ${op.result} chain ${got}`);
          op.chain = got;
          this.compareEvents(op, res);
        }
        return;
      }
      case "open_ticket": {
        const o = this.owner(a.owner);
        this.iss.mintTo(this.r.usdc, c.usdcAta(o.publicKey), BigInt(this.n), TOKEN);
        const t = c.openTicket(o, BigInt(this.n));
        if (this.expectOutcome(op, t.res)) {
          this.tickets.set(op.result, { pda: t.ticket, owner: a.owner });
          this.compareEvents(op, t.res);
        }
        return;
      }
      case "ticket_leg_lands": {
        const t = this.tickets.get(a.ticket)!;
        const o = this.owner(t.owner);
        const before = c.balance(a.leg);
        const res = c.ticketSwapLeg(o, t.pda, a.leg, 1n, 1n, big(a.gross));
        if (this.expectOutcome(op, res)) {
          const got = c.balance(a.leg) - before;
          if (got !== big(op.result)) this.fail(op, `landed delta: model ${op.result} chain ${got}`);
          this.compareEvents(op, res);
        }
        return;
      }
      case "finalize_ticket": {
        const t = this.tickets.get(a.ticket)!;
        const o = this.owner(t.owner);
        const before = c.shares(o.publicKey);
        const res = c.finalize(o, t.pda, big(a.min_shares));
        if (this.expectOutcome(op, res)) {
          const got = c.shares(o.publicKey) - before;
          if (got !== big(op.result)) this.fail(op, `finalize shares: model ${op.result} chain ${got}`);
          op.chain = got;
          this.compareEvents(op, res);
        }
        return;
      }
      case "redeem_in_kind":
      case "redeem_pending_sale": {
        const o = this.owner(a.owner);
        const inKind = op.op === "redeem_in_kind";
        const bal = c.mints.map((m) => tokenAmount(this.env, c.userAta(o.publicKey, m)));
        const vb = c.mints.map((_, i) => c.balance(i));
        const usdc0 = tokenAmount(this.env, c.usdcAta(o.publicKey));
        const { res, ticket } = c.redeem(o, big(a.shares), inKind ? "InKind" : { usdc: 0n });
        if (!this.expectOutcome(op, res)) return;
        this.compareEvents(op, res);
        const tk = c.redemption(ticket);
        op.chain = { ticket, paid: {} as Record<string, bigint>, claims: [] as number[] };
        const claims = new Map<number, any>();
        for (const cl of op.result.claims) {
          claims.set(cl.leg, cl);
          this.claims.set(cl.id, { ticket, owner: a.owner, leg: cl.leg });
        }
        for (let i = 0; i < this.n; i++) {
          const tl = tk.legs[i];
          if (claims.has(i)) {
            if (!tl.Claim || big(tl.Claim.units) !== big(claims.get(i).units)) this.fail(op, `leg ${i}: expected claim, ticket has ${JSON.stringify(tl)}`);
            op.chain.claims.push(i);
          } else if (inKind && op.result.paid[String(i)] !== undefined) {
            const got = tokenAmount(this.env, c.userAta(o.publicKey, c.mints[i])) - bal[i];
            if (got !== big(op.result.paid[String(i)])) this.fail(op, `leg ${i} paid: model ${op.result.paid[String(i)]} chain ${got}`);
            op.chain.paid[String(i)] = got;
            // Paid.amount = gross debited from the vault; Paid.received = the owner's measured net.
            if (!tl.Paid || big(tl.Paid.received) !== got || big(tl.Paid.amount) !== vb[i] - c.balance(i)) this.fail(op, `leg ${i} ticket record ${JSON.stringify(tl)}`);
          }
        }
        if (inKind && op.result.paid.usdc !== undefined) {
          const got = tokenAmount(this.env, c.usdcAta(o.publicKey)) - usdc0;
          if (got !== big(op.result.paid.usdc)) this.fail(op, `usdc paid: model ${op.result.paid.usdc} chain ${got}`);
          op.chain.paid.usdc = got;
        }
        return;
      }
      case "settle_claim": {
        const cl = this.claims.get(a.claim)!;
        const o = this.owner(cl.owner);
        const tk = c.redemption(cl.ticket);
        const pendingSale = tk.legs[cl.leg].Claim && "PendingSale" in tk.legs[cl.leg].Claim.reason;
        // Paused/Hook/Frozen claims are settled by a third party (permissionless); PendingSale only by the owner.
        const cranker = pendingSale ? o : this.env.payer;
        const before = tokenAmount(this.env, c.userAta(o.publicKey, c.mints[cl.leg]));
        const vb = c.balance(cl.leg);
        const res = c.settleClaim(cranker, cl.ticket, o.publicKey, cl.leg);
        if (this.expectOutcome(op, res)) {
          const got = tokenAmount(this.env, c.userAta(o.publicKey, c.mints[cl.leg])) - before;
          if (got !== big(op.result)) this.fail(op, `claim paid: model ${op.result} chain ${got}`);
          const ev = res.events.find((e) => e.name === "ClaimSettled");
          const tl = c.redemption(cl.ticket).legs[cl.leg];
          if (!ev || big(ev.data.received) !== got || big(ev.data.amount) !== vb - c.balance(cl.leg)) this.fail(op, "ClaimSettled amount/received");
          if (!tl.Paid || big(tl.Paid.received) !== got || big(tl.Paid.amount) !== vb - c.balance(cl.leg)) this.fail(op, "ticket Paid amount/received");
          op.chain = got;
          this.compareEvents(op, res);
        }
        return;
      }
      case "external_seize": {
        const i = a.leg;
        const amt = [big(a.amount), c.balance(i)].reduce((x, y) => (x < y ? x : y));
        if (amt > 0n) this.lifted(i, true, () => this.iss.seize(c.vaults[i], c.mints[i], amt));
        return;
      }
      case "external_donate": {
        const i = a.leg;
        this.lifted(i, true, () => this.iss.mintTo(c.mints[i], c.vaults[i], big(a.amount)));
        return;
      }
      case "observe": {
        const res = c.observe(a.legs);
        if (this.expectOutcome(op, res)) this.compareEvents(op, res);
        return;
      }
      case "set_available": {
        if (a.value) this.makeAvailable(a.leg);
        else this.makeUnavailable(a.leg);
        return;
      }
      case "set_fee": {
        this.iss.setFee(c.mints[a.leg], a.value);
        this.env.warp({ epochs: 2 }); // Token-2022 applies a new fee two epochs later
        return;
      }
      case "convert_listed_leg": {
        const i = a.leg;
        const st = c.legs()[i];
        if (st.status === "Active") {
          const now = this.env.clock().unixTimestamp;
          const fl = c.flagListing(i, now + BigInt(WEEK), now + BigInt(2 * WEEK));
          if (!fl.ok) this.fail(op, "flag_listing: " + fl.error);
          this.env.warp({ seconds: WEEK });
        }
        const amount = c.owned(i);
        const r0 = tokenAmount(this.env, c.reserve);
        const res = c.convert(i, amount, op.refused ? 1n : big(op.result));
        if (this.expectOutcome(op, res)) {
          const got = tokenAmount(this.env, c.reserve) - r0;
          if (got !== big(op.result)) this.fail(op, `convert usdc: model ${op.result} chain ${got}`);
          op.chain = got;
          this.compareEvents(op, res);
        }
        return;
      }
      case "reinvest_reserve": {
        for (const [k, v] of Object.entries(a.gross_out)) {
          const i = Number(k);
          const st = c.state();
          const mask = Number(st.reinvest_mask);
          const left = mask.toString(2).split("").filter((x) => x === "1").length;
          const r0 = tokenAmount(this.env, c.reserve);
          const slice = left === 1 ? r0 : r0 / BigInt(left);
          const res = c.reinvest(i, slice, big(v));
          this.expectOutcome(op, res);
        }
        return;
      }
      default:
        this.fail(op, "unknown op");
    }
  }

  // ---- on-chain views used by property checks (computed from chain state only) ----
  /** Units of every open claim on leg i, read from the redemption tickets on chain. */
  openClaimUnits(i: number): bigint[] {
    const out: bigint[] = [];
    const seen = new Set<string>();
    for (const cl of this.claims.values()) {
      if (cl.leg !== i || seen.has(cl.ticket.toBase58())) continue;
      seen.add(cl.ticket.toBase58());
      const tl = this.c.redemption(cl.ticket).legs[i];
      if (tl.Claim) out.push(big(tl.Claim.units));
    }
    return out;
  }
  owned(i: number) { return this.c.owned(i); }
  denom(i: number) { return this.c.supply() + this.c.legs()[i].claimUnits; }
  holderClaim(o: string, i: number) {
    const d = this.denom(i);
    return d === 0n ? 0n : (this.c.shares(this.owner(o).publicKey) * this.owned(i)) / d;
  }
  pendingActual(i: number) {
    const l = this.c.legs()[i];
    return (l.pendingNorm * l.lossIndex) / INDEX_ONE;
  }
}

export { T22, LEG_NAMES };
