// Devnet issuer-scenario suite (spec 02 Fixtures) against the deployed basket program.
// Every step that lands is a confirmed devnet signature recorded in tests/program/devnet/<scenario>.json.
// Refusals never land (no signature): they are recorded from a simulation of the signed transaction, with logs.
//
// Keys: ~/.config/solana/stocklana/program.json is the payer, the basket authority AND the fixture issuer
// (mint, pause, freeze, fee, hook, multiplier authority and permanent delegate) of fixture mints this script
// creates itself, because Agent C's fixture registry does not exist yet. Test users are derived keypairs.
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey,
  SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { ix } from "../src/basket.ts";
import { PROGRAM_ID, ROOT, T22, TOKEN, coder, kp, parseEvents, u64le } from "../src/env.ts";
import { LEG_NAMES, legMintIxs, U64_MAX } from "../src/fixtures.ts";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const OUT = path.join(ROOT, "tests/program/devnet");
const KEYFILE = path.join(process.env.HOME!, ".config/solana/stocklana/program.json");
const issuer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, "utf8"))));
const SEED = process.env.DEVNET_SEED ?? "devnet-v1";
const alice = kp(`${SEED}:alice`), bob = kp(`${SEED}:bob`);
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"); // any program id, used as "a hook"
const bn = (x: bigint | number) => new BN(x.toString());
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const big = (x: any) => BigInt(x.toString());
const fee = (amt: bigint, bps: bigint) => (amt === 0n ? 0n : (amt * bps + 9_999n) / 10_000n);

let rec: any;
function begin(name: string, extra: any = {}) {
  rec = { scenario: name, cluster: "devnet", rpc: RPC, program: PROGRAM_ID.toBase58(), startedAt: new Date().toISOString(),
    keys: { payerAuthorityAndFixtureIssuer: issuer.publicKey.toBase58(), alice: alice.publicKey.toBase58(), bob: bob.publicKey.toBase58() },
    note: "Fixture mints created by this suite with the program key as issuer (Agent C's registry not available).", ...extra, steps: [] as any[], checks: [] as any[] };
}
function save(name = rec.scenario) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(rec, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));
}
function check(what: string, ok: boolean, detail: any = {}) {
  rec.checks.push({ what, ok, ...detail });
  console.log(`  ${ok ? "✔" : "✖"} ${what}`);
  if (!ok) { save(); throw new Error("check failed: " + what + " " + JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v))); }
}

async function build(ixs: TransactionInstruction[], signers: Keypair[], alts: AddressLookupTableAccount[]) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: issuer.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs] }).compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  const need = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).map((k) => k.toBase58());
  const uniq = new Map<string, Keypair>();
  for (const s of [issuer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
  tx.sign([...uniq.values()].filter((k) => need.includes(k.publicKey.toBase58())));
  return { tx, blockhash, lastValidBlockHeight };
}

let ALT: AddressLookupTableAccount[] = [];
async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  for (let attempt = 0; ; attempt++) {
    const { tx, blockhash, lastValidBlockHeight } = await build(ixs, signers, ALT);
    try {
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      const logs = t?.meta?.logMessages ?? [];
      const step = { label, signature: sig, slot: t?.slot, ok: !t?.meta?.err, cu: t?.meta?.computeUnitsConsumed, size: tx.serialize().length,
        events: parseEvents(logs).map((e) => ({ name: e.name, data: e.data })) };
      rec.steps.push(step);
      save();
      console.log(`${label}: ${sig}`);
      if (!step.ok) throw new Error(`${label} landed with an error`);
      return step;
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (attempt < 3 && /blockhash|timeout|429|block height exceeded|fetch failed/i.test(msg)) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
      rec.steps.push({ label, ok: false, error: msg.slice(0, 500), logs: e.logs });
      save();
      throw e;
    }
  }
}

/** A refusal: simulate the signed transaction (it would never land) and record the program error and logs. */
async function refused(label: string, ixs: TransactionInstruction[], signers: Keypair[], expectError: string) {
  const { tx } = await build(ixs, signers, ALT);
  const sim = await conn.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
  const logs = sim.value.logs ?? [];
  const code = logs.map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean);
  rec.steps.push({ label, refused: true, simulatedAtSlot: sim.context.slot, error: sim.value.err, errorCode: code, logs: logs.filter((l) => /Error|failed|Instruction:/.test(l)) });
  save();
  console.log(`${label}: refused (${code ?? JSON.stringify(sim.value.err)})`);
  check(`${label} → ${expectError}`, code === expectError, { got: code ?? sim.value.err });
}

// ---------------------------------------------------------------- fixtures (shared by all scenarios)
const fx = JSON.parse(fs.existsSync(path.join(OUT, "setup.json")) ? fs.readFileSync(path.join(OUT, "setup.json"), "utf8") : "{}");
let MINTS: PublicKey[] = [];
let USDC: PublicKey;

async function tokenAmount(acc: PublicKey) {
  const a = await conn.getAccountInfo(acc, "confirmed");
  return a ? a.data.readBigUInt64LE(64) : 0n;
}

async function setup() {
  begin("setup");
  if (fx.mints) {
    MINTS = fx.mints.map((m: string) => new PublicKey(m));
    USDC = new PublicKey(fx.usdc);
    ALT = [(await conn.getAddressLookupTable(new PublicKey(fx.alt))).value!];
    rec = { ...fx, steps: fx.steps, checks: fx.checks ?? [] };
    return;
  }
  const mints = LEG_NAMES.map((n) => kp(`${SEED}:mint:${n}`));
  for (const [i, m] of mints.entries()) {
    const { len } = legMintIxs(issuer.publicKey, m.publicKey, issuer.publicKey, LEG_NAMES[i], 100);
    const { tx1, tx2 } = legMintIxs(issuer.publicKey, m.publicKey, issuer.publicKey, LEG_NAMES[i], 100, i === 0 ? 1.4861347 : 1,
      await conn.getMinimumBalanceForRentExemption(len));
    await send(`create fixture mint ${LEG_NAMES[i]} (extensions)`, tx1, [m]);
    await send(`init fixture mint ${LEG_NAMES[i]} (mint + metadata)`, tx2, []);
  }
  const usdc = kp(`${SEED}:usdc`);
  await send("create fixture USDC (classic SPL, 6 decimals)", [
    SystemProgram.createAccount({ fromPubkey: issuer.publicKey, newAccountPubkey: usdc.publicKey, space: 82, lamports: await conn.getMinimumBalanceForRentExemption(82), programId: TOKEN }),
    spl.createInitializeMint2Instruction(usdc.publicKey, 6, issuer.publicKey, null, TOKEN),
  ], [usdc]);
  MINTS = mints.map((m) => m.publicKey);
  USDC = usdc.publicKey;
  // Lookup table of shared addresses (programs, mints, USDC) so 7-leg instructions fit a transaction.
  const slot = await conn.getSlot("confirmed");
  const [create, key] = AddressLookupTableProgram.createLookupTable({ authority: issuer.publicKey, payer: issuer.publicKey, recentSlot: slot - 1 });
  await send("create lookup table", [create]);
  await send("extend lookup table", [AddressLookupTableProgram.extendLookupTable({ lookupTable: key, authority: issuer.publicKey, payer: issuer.publicKey,
    addresses: [PROGRAM_ID, T22, TOKEN, spl.ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, USDC, ...MINTS] })]);
  await new Promise((ok) => setTimeout(ok, 2000));
  ALT = [(await conn.getAddressLookupTable(key)).value!];
  // Users: the issuer pays fees; users need a little SOL for their redemption-ticket rent. Their token accounts.
  await send("fund alice and bob with 0.03 SOL each (redemption ticket rent)", [alice, bob].map((u) => SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: u.publicKey, lamports: 30_000_000 })));
  for (const u of [alice, bob]) {
    const ixs = [...MINTS.map((m) => spl.createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, spl.getAssociatedTokenAddressSync(m, u.publicKey, false, T22), u.publicKey, m, T22)),
      spl.createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, spl.getAssociatedTokenAddressSync(USDC, u.publicKey, false, TOKEN), u.publicKey, USDC, TOKEN)];
    await send(`token accounts for ${u === alice ? "alice" : "bob"} (1/2)`, ixs.slice(0, 4));
    await send(`token accounts for ${u === alice ? "alice" : "bob"} (2/2)`, ixs.slice(4));
  }
  Object.assign(rec, { mints: MINTS.map((m) => m.toBase58()), names: LEG_NAMES, usdc: USDC.toBase58(), alt: key.toBase58(), finishedAt: new Date().toISOString() });
  save("setup");
}

// ---------------------------------------------------------------- basket per scenario
class B {
  shareMint: Keypair; basket: PublicKey; vaults: PublicKey[]; reserve: PublicKey; nonce = new Map<string, number>();
  constructor(label: string) {
    this.shareMint = kp(`${SEED}:share:${label}`);
    [this.basket] = PublicKey.findProgramAddressSync([Buffer.from("basket"), this.shareMint.publicKey.toBuffer()], PROGRAM_ID);
    this.vaults = MINTS.map((m) => spl.getAssociatedTokenAddressSync(m, this.basket, true, T22));
    this.reserve = spl.getAssociatedTokenAddressSync(USDC, this.basket, true, TOKEN);
  }
  ata(o: PublicKey, m: PublicKey) { return spl.getAssociatedTokenAddressSync(m, o, false, m.equals(USDC) || m.equals(this.shareMint.publicKey) ? TOKEN : T22); }
  shareAta(o: PublicKey) { return spl.getAssociatedTokenAddressSync(this.shareMint.publicKey, o, false, TOKEN); }
  async state() { return coder.accounts.decode("Basket", (await conn.getAccountInfo(this.basket, "confirmed"))!.data) as any; }
  async supply() { return (await conn.getTokenSupply(this.shareMint.publicKey, "confirmed")).value.amount; }
  async owned(i: number) {
    const l = (await this.state()).legs[i];
    return (await tokenAmount(this.vaults[i])) - (big(l.pending_norm) * big(l.loss_index)) / 10n ** 18n;
  }
  async claimValue(i: number, units: bigint) {
    const l = (await this.state()).legs[i];
    return (units * (await this.owned(i))) / (BigInt(await this.supply()) + big(l.claim_units));
  }
  legs3(o: PublicKey) { return MINTS.flatMap((m, i) => [r(m), w(this.vaults[i]), w(this.ata(o, m))]); }

  async create() {
    await send("create share mint (authority = basket PDA)", [
      SystemProgram.createAccount({ fromPubkey: issuer.publicKey, newAccountPubkey: this.shareMint.publicKey, space: 82, lamports: await conn.getMinimumBalanceForRentExemption(82), programId: TOKEN }),
      spl.createInitializeMint2Instruction(this.shareMint.publicKey, 9, this.basket, null, TOKEN),
      ...[issuer, alice, bob].map((u) => spl.createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, this.shareAta(u.publicKey), u.publicKey, this.shareMint.publicKey, TOKEN)),
    ], [this.shareMint]);
    await send("initialize_basket", [ix("initialize_basket", { payer: issuer.publicKey, authority: issuer.publicKey, basket: this.basket, share_mint: this.shareMint.publicKey,
      usdc_mint: USDC, usdc_reserve: this.reserve }, { n_legs: 7, mirror_of: MINTS, max_convert_chunk: bn(U64_MAX), routers: [] }, MINTS.flatMap((m, i) => [r(m), w(this.vaults[i])]))]);
    rec.basket = this.basket.toBase58();
    rec.shareMint = this.shareMint.publicKey.toBase58();
    rec.vaults = this.vaults.map((v) => v.toBase58());
  }
  async mintLegs(u: Keypair, amt: bigint) {
    const ixs = MINTS.map((m) => spl.createMintToInstruction(m, this.ata(u.publicKey, m), issuer.publicKey, amt, [], T22));
    await send(`fixture issuer mints ${amt} raw of each leg to ${u === alice ? "alice" : u === bob ? "bob" : "the authority"}`, ixs);
  }
  bootstrapIx(gross: bigint) {
    return ix("bootstrap", { depositor: issuer.publicKey, basket: this.basket, share_mint: this.shareMint.publicKey, depositor_share_ata: this.shareAta(issuer.publicKey) },
      { gross: MINTS.map(() => bn(gross)) }, this.legs3(issuer.publicKey));
  }
  depositIx(u: Keypair, gross: bigint[], minShares = 0n) {
    return ix("deposit_in_kind", { depositor: u.publicKey, basket: this.basket, share_mint: this.shareMint.publicKey, depositor_share_ata: this.shareAta(u.publicKey) },
      { gross: gross.map(bn), min_shares: bn(minShares) }, this.legs3(u.publicKey));
  }
  redeemIx(u: Keypair, shares: bigint) {
    const k = u.publicKey.toBase58();
    const n = this.nonce.get(k) ?? 0;
    this.nonce.set(k, n + 1);
    const ticket = PublicKey.findProgramAddressSync([Buffer.from("redeem"), this.basket.toBuffer(), u.publicKey.toBuffer(), u64le(n)], PROGRAM_ID)[0];
    return { ticket, ix: ix("redeem", { owner: u.publicKey, basket: this.basket, share_mint: this.shareMint.publicKey, owner_share_ata: this.shareAta(u.publicKey), ticket, usdc_reserve: null, owner_usdc: null },
      { nonce: bn(n), shares: bn(shares), mode: { InKind: {} } }, this.legs3(u.publicKey)) };
  }
  settleIx(cranker: Keypair, ticket: PublicKey, owner: PublicKey, i: number) {
    return ix("settle_claim", { cranker: cranker.publicKey, basket: this.basket, ticket, leg_mint: MINTS[i], leg_vault: this.vaults[i], owner_token_account: this.ata(owner, MINTS[i]), share_mint: this.shareMint.publicKey }, { leg: i });
  }
  observeIx(legs: number[]) {
    return ix("observe", { cranker: issuer.publicKey, basket: this.basket }, { legs: legs.reduce((a, i) => a | (1 << i), 0) }, legs.flatMap((i) => [r(MINTS[i]), r(this.vaults[i])]));
  }
  async ticketLegs(ticket: PublicKey) { return (coder.accounts.decode("RedemptionTicket", (await conn.getAccountInfo(ticket, "confirmed"))!.data) as any).legs; }
  async standard() {
    await this.create();
    await this.mintLegs(issuer, 10n ** 12n);
    await send("bootstrap (INITIAL_SHARES, in kind)", [this.bootstrapIx(10n ** 12n)]);
    await this.mintLegs(alice, 5n * 10n ** 11n);
    await send("alice deposit_in_kind", [this.depositIx(alice, MINTS.map(() => 5n * 10n ** 11n))], [alice]);
    check("bootstrap minted INITIAL_SHARES", BigInt((await conn.getTokenAccountBalance(this.shareAta(issuer.publicKey))).value.amount) === 1_000_000_000n);
  }
}

// ---------------------------------------------------------------- issuer actions
const act = {
  pause: (i: number) => send(`ISSUER pauses ${LEG_NAMES[i]}`, [spl.createPauseInstruction(MINTS[i], issuer.publicKey, [], T22)]),
  resume: (i: number) => send(`ISSUER resumes ${LEG_NAMES[i]}`, [spl.createResumeInstruction(MINTS[i], issuer.publicKey, [], T22)]),
  hook: (i: number, p: PublicKey) => send(`ISSUER sets ${LEG_NAMES[i]} transfer hook to ${p.equals(PublicKey.default) ? "null" : p.toBase58()}`, [spl.createUpdateTransferHookInstruction(MINTS[i], issuer.publicKey, p, [], T22)]),
  freeze: (acc: PublicKey, i: number) => send(`ISSUER freezes the basket's ${LEG_NAMES[i]} vault`, [spl.createFreezeAccountInstruction(acc, MINTS[i], issuer.publicKey, [], T22)]),
  thaw: (acc: PublicKey, i: number) => send(`ISSUER thaws the basket's ${LEG_NAMES[i]} vault`, [spl.createThawAccountInstruction(acc, MINTS[i], issuer.publicKey, [], T22)]),
  seize: (acc: PublicKey, i: number, amt: bigint) => send(`ISSUER seizes ${amt} raw ${LEG_NAMES[i]} from the vault (permanent-delegate burn; the vault does not sign)`, [spl.createBurnCheckedInstruction(acc, MINTS[i], issuer.publicKey, amt, 9, [], T22)]),
};

async function redeemAndCheck(b: B, u: Keypair, s: bigint, claimLegs: number[], label: string) {
  const S = BigInt(await b.supply());
  const st = await b.state();
  const before = await Promise.all(MINTS.map((m) => tokenAmount(b.ata(u.publicKey, m))));
  const expect: bigint[] = [];
  for (let i = 0; i < 7; i++) expect.push((s * (await b.owned(i))) / (S + big(st.legs[i].claim_units)));
  const { ticket, ix: rix } = b.redeemIx(u, s);
  const step = await send(label, [rix], [u]);
  const after = await Promise.all(MINTS.map((m) => tokenAmount(b.ata(u.publicKey, m))));
  const tl = await b.ticketLegs(ticket);
  for (let i = 0; i < 7; i++) {
    if (claimLegs.includes(i)) check(`${LEG_NAMES[i]} became a claim of ${s} units`, !!tl[i].Claim && big(tl[i].Claim.units) === s && after[i] === before[i], { ticketLeg: tl[i] });
    else check(`${LEG_NAMES[i]} paid now: gross ${expect[i]} = floor(s·owned/(S+C)), received ${after[i] - before[i]}`, !!tl[i].Paid && big(tl[i].Paid.amount) === expect[i] && big(tl[i].Paid.received) === after[i] - before[i], { expect: expect[i] });
  }
  check("ClaimCreated emitted for exactly the unavailable legs", JSON.stringify(step.events.filter((e: any) => e.name === "ClaimCreated").map((e: any) => e.data.leg)) === JSON.stringify(claimLegs));
  return ticket;
}

async function settleAndCheck(b: B, cranker: Keypair, ticket: PublicKey, owner: PublicKey, i: number, label: string) {
  const units = big((await b.ticketLegs(ticket))[i].Claim.units);
  const owed = await b.claimValue(i, units);
  const before = await tokenAmount(b.ata(owner, MINTS[i]));
  const step = await send(label, [b.settleIx(cranker, ticket, owner, i)], [cranker]);
  const got = (await tokenAmount(b.ata(owner, MINTS[i]))) - before;
  const ev = step.events.find((e: any) => e.name === "ClaimSettled");
  check(`${LEG_NAMES[i]} claim settled: amount ${owed} = floor(units·owned/(S+C)) at settlement, received ${got}`, !!ev && big(ev.data.amount) === owed && big(ev.data.received) === got);
  return { owed, got };
}

// ---------------------------------------------------------------- scenarios
const scenarios: Record<string, () => Promise<void>> = {
  async seizure() {
    begin("seizure");
    const b = new B("seizure");
    await b.standard();
    const bal = await tokenAmount(b.vaults[2]);
    const seized = bal / 4n;
    await act.seize(b.vaults[2], 2, seized);
    const obs = await send("observe (permissionless) emits ShortfallObserved", [b.observeIx([2])]);
    const sf = obs.events.find((e: any) => e.name === "ShortfallObserved");
    check("ShortfallObserved { expected: A, actual: B }", !!sf && big(sf.data.expected) === bal && big(sf.data.actual) === bal - seized, { event: sf?.data });
    const s = BigInt((await conn.getTokenAccountBalance(b.shareAta(alice.publicKey))).value.amount) / 2n;
    await redeemAndCheck(b, alice, s, [], "alice redeems half in kind: leg 2 pays pro-rata less");
    // A later depositor sized to the current (post-seizure) composition gets shares at the reduced rate.
    const owned = await Promise.all(MINTS.map((_, i) => b.owned(i)));
    const gross = owned.map((o) => (o / 10n) * 10_000n / 9_900n + 1n);
    await b.mintLegs(bob, gross.reduce((a, x) => (a > x ? a : x)));
    const S = BigInt(await b.supply());
    const st = await b.state();
    const sb = BigInt((await conn.getTokenAccountBalance(b.shareAta(bob.publicKey))).value.amount);
    await send("bob deposits in kind at the reduced composition", [b.depositIx(bob, gross)], [bob]);
    const got = BigInt((await conn.getTokenAccountBalance(b.shareAta(bob.publicKey))).value.amount) - sb;
    let m = -1n;
    for (let i = 0; i < 7; i++) {
      const d = gross[i] - fee(gross[i], 100n);
      const cand = (d * (S + big(st.legs[i].claim_units))) / owned[i];
      if (m < 0n || cand < m) m = cand;
    }
    check(`bob minted ${got} shares = min_i floor(Δ_i(S+C_i)/owned_i) = ${m}; ≈ S/10 (no top-up of the seized leg)`, got === m, { S });
  },

  async "pause-mid-redemption"() {
    begin("pause-mid-redemption");
    const b = new B("pause");
    await b.standard();
    const aliceShares = BigInt((await conn.getTokenAccountBalance(b.shareAta(alice.publicKey))).value.amount);
    // (a) one leg paused between deposit and redemption
    await act.pause(1);
    const t1 = await redeemAndCheck(b, alice, aliceShares / 4n, [1], "alice redeems 1/4 with OPENAI… leg 1 (ANTHROPIC) paused: six legs paid, one claim");
    await refused("settle_claim while ANTHROPIC is paused", [b.settleIx(bob, t1, alice.publicKey, 1)], [bob], "LegUnavailable");
    await act.resume(1);
    await settleAndCheck(b, bob, t1, alice.publicKey, 1, "bob (a third party) settles alice's ANTHROPIC claim after resume");
    // (b) several legs paused; deposits refused
    await act.pause(3);
    await act.pause(5);
    await b.mintLegs(bob, 10n ** 9n);
    await refused("bob deposit_in_kind while two legs are paused", [b.depositIx(bob, MINTS.map(() => 10n ** 9n))], [bob], "LegUnavailable");
    const t2 = await redeemAndCheck(b, alice, aliceShares / 4n, [3, 5], "alice redeems 1/4 with legs 3 and 5 paused: five paid, two claims");
    // (c) seizure while the claims are open (the issuer resumes to burn, then pauses again)
    await act.resume(3);
    const v3 = await tokenAmount(b.vaults[3]);
    await act.seize(b.vaults[3], 3, v3 / 5n);
    await act.pause(3);
    const obs = await send("observe: ShortfallObserved on ANDURIL while the claim is open", [b.observeIx([3])]);
    check("ShortfallObserved on leg 3", obs.events.some((e: any) => e.name === "ShortfallObserved" && e.data.leg === 3));
    await refused("settle_claim on leg 5 while paused", [b.settleIx(bob, t2, alice.publicKey, 5)], [bob], "LegUnavailable");
    await act.resume(3);
    await act.resume(5);
    await settleAndCheck(b, bob, t2, alice.publicKey, 3, "claim on the seized leg settles after resume, at the post-seizure pro-rata value");
    await settleAndCheck(b, bob, t2, alice.publicKey, 5, "claim on leg 5 settles after resume");
  },

  async "fee-change-mid-position"() {
    begin("fee-change-mid-position");
    const b = new B("fee");
    await b.standard();
    const epoch = (await conn.getEpochInfo("confirmed")).epoch;
    for (let i = 0; i < 7; i += 4) {
      await send(`ISSUER set-transfer-fee 100 → 300 bps (legs ${i}..${Math.min(i + 3, 6)})`, MINTS.slice(i, i + 4).map((m) => spl.createSetTransferFeeInstruction(m, issuer.publicKey, [], 300, U64_MAX, T22)));
    }
    const cfg = spl.getTransferFeeConfig(await spl.getMint(conn, MINTS[0], "confirmed", T22))!;
    check(`newer fee 300 bps effective at epoch ${cfg.newerTransferFee.epoch} (= current ${epoch} + 2)`, Number(cfg.newerTransferFee.transferFeeBasisPoints) === 300 && Number(cfg.newerTransferFee.epoch) === epoch + 2);
    const s = BigInt((await conn.getTokenAccountBalance(b.shareAta(alice.publicKey))).value.amount) / 3n;
    const S = BigInt(await b.supply());
    const gross0 = (s * (await b.owned(0))) / S;
    const before = await tokenAmount(b.ata(alice.publicKey, MINTS[0]));
    await redeemAndCheck(b, alice, s, [], "alice redeems with the new fee scheduled: the current (older) 100 bps applies");
    const got = (await tokenAmount(b.ata(alice.publicKey, MINTS[0]))) - before;
    check(`recipient net = gross − ceil(gross·100/10⁴) (${gross0} → ${got}); the program stores no fee`, got === gross0 - fee(gross0, 100n));
    rec.pending = `The 300 bps fee takes effect at epoch ${cfg.newerTransferFee.epoch} (~2 days on devnet). A redemption after that epoch is the second half of this scenario; see tests/program/devnet/fee-change-mid-position-after.json if present. The effect itself is proven in LiteSVM (guards.test.ts, fee change mid-ticket) and on the cloned-mainnet fork, where time travel crossed PreStocks' real epoch-1043 change (300 bps charged on convert_listed_leg).`;
    rec.feeEffectiveEpoch = Number(cfg.newerTransferFee.epoch);
  },

  async "multiplier-change-mid-position"() {
    begin("multiplier-change-mid-position");
    const b = new B("multiplier");
    await b.standard();
    const now = Math.floor(Date.now() / 1000);
    await send("ISSUER update-ui-amount-multiplier OPENAI 1.4861347 → 2.0, effective in 60 s", [spl.createUpdateMultiplierDataInstruction(MINTS[0], issuer.publicKey, 2.0, BigInt(now + 60), [], T22)]);
    const s = BigInt((await conn.getTokenAccountBalance(b.shareAta(alice.publicKey))).value.amount) / 4n;
    await redeemAndCheck(b, alice, s, [], "redeem before the multiplier takes effect: raw amounts by the share formula");
    await new Promise((ok) => setTimeout(ok, 65_000));
    const cfg = spl.getScaledUiAmountConfig(await spl.getMint(conn, MINTS[0], "confirmed", T22));
    rec.multiplier = cfg;
    await redeemAndCheck(b, alice, s, [], "redeem after the multiplier took effect: raw amounts still by the same formula (the program never reads it)");
  },

  async "hook-switched-on"() {
    begin("hook-switched-on");
    const b = new B("hook");
    await b.standard();
    await act.hook(4, MEMO);
    await b.mintLegs(bob, 10n ** 9n);
    await refused("bob deposit_in_kind with a hook on POLYMARKET", [b.depositIx(bob, MINTS.map(() => 10n ** 9n))], [bob], "LegUnavailable");
    const s = BigInt((await conn.getTokenAccountBalance(b.shareAta(alice.publicKey))).value.amount) / 2n;
    const t = await redeemAndCheck(b, alice, s, [4], "alice redeems: POLYMARKET (hook set) becomes a claim, the rest pay");
    check("claim reason Hook", "Hook" in (await b.ticketLegs(t))[4].Claim.reason);
    await refused("settle_claim while the hook is set", [b.settleIx(bob, t, alice.publicKey, 4)], [bob], "LegUnavailable");
    await act.hook(4, PublicKey.default);
    await settleAndCheck(b, bob, t, alice.publicKey, 4, "hook removed: the claim settles");
  },

  async "frozen-vault"() {
    begin("frozen-vault");
    const b = new B("frozen");
    await b.standard();
    await act.freeze(b.vaults[6], 6);
    await b.mintLegs(bob, 10n ** 9n);
    await refused("bob deposit_in_kind with the FIGUREAI vault frozen", [b.depositIx(bob, MINTS.map(() => 10n ** 9n))], [bob], "LegUnavailable");
    const s = BigInt((await conn.getTokenAccountBalance(b.shareAta(alice.publicKey))).value.amount) / 2n;
    const t = await redeemAndCheck(b, alice, s, [6], "alice redeems: the frozen FIGUREAI vault becomes a claim, the rest pay");
    check("claim reason Frozen", "Frozen" in (await b.ticketLegs(t))[6].Claim.reason);
    await refused("settle_claim while the vault is frozen", [b.settleIx(bob, t, alice.publicKey, 6)], [bob], "LegUnavailable");
    await act.thaw(b.vaults[6], 6);
    await settleAndCheck(b, bob, t, alice.publicKey, 6, "vault thawed: the claim settles");
  },
};

async function main() {
  const prog = await conn.getAccountInfo(PROGRAM_ID);
  if (!prog?.executable) throw new Error(`basket program ${PROGRAM_ID.toBase58()} is not deployed on ${RPC}`);
  await setup();
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
  for (const name of which) {
    console.log(`\n== ${name}`);
    await scenarios[name]();
    rec.finishedAt = new Date().toISOString();
    rec.passed = rec.checks.every((c: any) => c.ok);
    save();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
