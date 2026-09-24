// Cloned-mainnet fork proof (surfpool on 127.0.0.1:8899): the real basket program CPIs Jupiter v6 with live
// /swap/v2/build routes against the REAL PreStocks mints: ticket_swap_leg, settle_leg_usdc, convert_listed_leg
// (and reinvest_reserve). Records signatures, CU, tx size, account counts and CPI depth per leg.
// Nothing here is sent to mainnet: every transaction goes to the local fork. Mainnet is only read (by surfpool).
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

const RPC = "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
const JUP = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const LEGS: [string, string][] = [
  ["OPENAI", "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF"],
  ["ANTHROPIC", "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw"],
  ["NEURALINK", "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S"],
  ["ANDURIL", "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB"],
  ["POLYMARKET", "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP"],
  ["KALSHI", "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua"],
  ["FIGUREAI", "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd"],
];
const MINTS = LEGS.map(([, m]) => new PublicKey(m));
const OUT = path.join(ROOT, "tests/program/fork");
const RUN = process.env.FORK_RUN ?? new Date().toISOString().replace(/[:.]/g, "-");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME!, ".config/solana/stocklana/program.json"), "utf8"))));
const USDC_PER_LEG = BigInt(process.env.USDC_PER_LEG ?? 10_000_000); // $10 per leg
const MAX_ACCOUNTS = Number(process.env.MAX_ACCOUNTS ?? 30);
// Prop AMMs whose on-chain quotes depend on per-slot oracle/keeper updates fail on a lazily cloned fork (stale
// state), and surfpool cannot load some programs. They are excluded on the fork only, and every exclusion that
// the retry loop adds is recorded in the transcript. Manifest is always excluded (it over-quotes by the fee).
// 1DEX is excluded everywhere (spec 02): it requires a system-owned taker. Everything else is tried first and
// excluded per leg only after it fails on the fork (each failure is recorded).
const FORK_EXCLUDE = (process.env.FORK_EXCLUDE ?? "1DEX").split(",").filter(Boolean);
// After surfnet_timeTravel the fork is at epoch ≥ 1043, where PreStocks' real schedule charges 300 bps, while
// Jupiter quotes at mainnet's current epoch (100 bps): its own slippage check needs room for the 2 % gap.
let SLIPPAGE_BPS = "150";

const transcript: any = { run: RUN, rpc: RPC, program: PROGRAM_ID.toBase58(), router: JUP.toBase58(), steps: [] as any[], jupiter: [] as any[], legs: {} as any };
const bn = (x: bigint | number) => new BN(x.toString());
const w = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });

async function rpc(method: string, params: any[]) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j: any = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

function save() {
  fs.writeFileSync(path.join(OUT, `transcript-${RUN}.json`), JSON.stringify(transcript, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));
}

// ---------------------------------------------------------------- sending
async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[], alts: AddressLookupTableAccount[] = [], opts: { expectFail?: boolean; tolerate?: boolean; cu?: number } = {}) {
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu ?? 1_400_000 }), ...ixs];
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToV0Message(alts);
  const tx = new VersionedTransaction(msg);
  const uniq = new Map<string, Keypair>();
  for (const s of [payer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
  const need = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).map((k) => k.toBase58());
  tx.sign([...uniq.values()].filter((k) => need.includes(k.publicKey.toBase58())));
  const bytes = tx.serialize();
  const loaded = msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  const step: any = { label, size: bytes.length, accounts: msg.staticAccountKeys.length + loaded, staticAccounts: msg.staticAccountKeys.length, lookupAccounts: loaded, instructions: all.length };
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: "confirmed" });
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e: any) {
    step.ok = false;
    step.error = String(e.message ?? e).slice(0, 400);
    step.logs = e.logs ?? (typeof e.getLogs === "function" ? await e.getLogs(conn).catch(() => undefined) : undefined);
    transcript.steps.push(step);
    save();
    if (opts.expectFail || opts.tolerate) return step;
    throw new Error(`${label} failed: ${step.error}\n${(step.logs ?? []).slice(-25).join("\n")}`);
  }
  const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const logs = t?.meta?.logMessages ?? [];
  step.ok = !t?.meta?.err;
  step.signature = sig;
  step.slot = t?.slot;
  step.cu = t?.meta?.computeUnitsConsumed;
  step.cpiDepth = Math.max(0, ...logs.map((l) => Number(l.match(/invoke \[(\d+)\]/)?.[1] ?? 0)));
  step.programs = [...new Set(logs.map((l) => l.match(/^Program (\w+) invoke/)?.[1]).filter(Boolean))];
  step.events = parseEvents(logs).map((e) => ({ name: e.name, data: e.data }));
  step.logs = logs;
  transcript.steps.push(step);
  save();
  console.log(`${label}: ${sig.slice(0, 16)}… slot ${step.slot} cu ${step.cu} size ${step.size}B accounts ${step.accounts} depth ${step.cpiDepth}`);
  if (opts.expectFail && step.ok) throw new Error(`${label} was expected to fail`);
  return step;
}

// ---------------------------------------------------------------- jupiter
let lastJup = 0;
async function jupiterBuild(params: Record<string, string>) {
  const wait = lastJup + 2_100 - Date.now(); // keyless limit 0.5 req/s
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  lastJup = Date.now();
  const q = new URLSearchParams({ slippageBps: SLIPPAGE_BPS, maxAccounts: String(MAX_ACCOUNTS), excludeDexes: "Manifest", ...params });
  const url = `https://api.jup.ag/swap/v2/build?${q}`;
  let res: Response = await fetch(url);
  for (let k = 0; res.status === 429 && k < 8; k++) {
    // Keyless limit is shared by everything on this IP (other agents too): back off and retry.
    await new Promise((ok) => setTimeout(ok, 5_000 * (k + 1)));
    lastJup = Date.now();
    res = await fetch(url);
  }
  const body: any = await res.json();
  transcript.jupiter.push({ at: new Date().toISOString(), url, status: res.status, outAmount: body.outAmount, otherAmountThreshold: body.otherAmountThreshold,
    route: body.routePlan?.map((p: any) => p.swapInfo?.label), swapAccounts: body.swapInstruction?.accounts?.length,
    swapDiscriminator: body.swapInstruction ? Buffer.from(body.swapInstruction.data, "base64").subarray(0, 8).toString("hex") : undefined,
    setup: body.setupInstructions?.map((s: any) => ({ program: s.programId, accounts: s.accounts.map((a: any) => a.pubkey) })),
    cleanup: body.cleanupInstruction ? { program: body.cleanupInstruction.programId, accounts: body.cleanupInstruction.accounts.map((a: any) => a.pubkey) } : null,
    lookupTables: Object.keys(body.addressesByLookupTableAddress ?? {}), error: body.error });
  if (res.status !== 200 || !body.swapInstruction) throw new Error(`jupiter ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function jupAlts(body: any): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const k of Object.keys(body.addressesByLookupTableAddress ?? {})) {
    const a = await conn.getAddressLookupTable(new PublicKey(k));
    if (a.value) out.push(a.value);
  }
  return out;
}

/** Jupiter setup instructions that create token accounts owned by a PDA are re-issued with `payer` paying. */
function setupIxs(body: any, pda: PublicKey, owner: PublicKey, skip: Set<string> = new Set()): { ixs: TransactionInstruction[]; created: PublicKey[] } {
  const ixs: TransactionInstruction[] = [];
  const created: PublicKey[] = [];
  for (const s of body.setupInstructions ?? []) {
    if (s.programId !== spl.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) continue;
    const ata = new PublicKey(s.accounts[1].pubkey);
    if (skip.has(ata.toBase58())) continue;
    const keys = s.accounts.map((a: any, i: number) => ({ pubkey: i === 0 ? owner : new PublicKey(a.pubkey), isSigner: i === 0, isWritable: a.isWritable }));
    ixs.push(new TransactionInstruction({ programId: spl.ASSOCIATED_TOKEN_PROGRAM_ID, keys, data: Buffer.from([1]) })); // CreateIdempotent
    created.push(ata);
  }
  return { ixs, created };
}

function routeAccounts(body: any) {
  return body.swapInstruction.accounts.map((a: any) => ({ pubkey: new PublicKey(a.pubkey), isSigner: false, isWritable: a.isWritable }));
}

// ---------------------------------------------------------------- fork state helpers
async function tokenAmount(acc: PublicKey): Promise<bigint> {
  const a = await conn.getAccountInfo(acc);
  return a ? a.data.readBigUInt64LE(64) : 0n;
}
/** Create the ATA with the real ATA program, then set its amount on the fork (surfnet_setAccount). */
async function giveTokens(owner: PublicKey, mint: PublicKey, program: PublicKey, amount: bigint) {
  const ata = spl.getAssociatedTokenAddressSync(mint, owner, true, program);
  if (!(await conn.getAccountInfo(ata))) {
    await send(`create ATA ${mint.toBase58().slice(0, 6)} for ${owner.toBase58().slice(0, 6)}`,
      [spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint, program)], []);
  }
  const a = (await conn.getAccountInfo(ata))!;
  const data = Buffer.from(a.data);
  data.writeBigUInt64LE(amount, 64);
  await rpc("surfnet_setAccount", [ata.toBase58(), { data: data.toString("hex") }]);
  return ata;
}

async function createAlt(addresses: PublicKey[]): Promise<AddressLookupTableAccount> {
  // A slot the fork itself produced (the fork's "finalized" slot can predate its own slot hashes).
  const start = await conn.getSlot("processed");
  while ((await conn.getSlot("processed")) < start + 2) await new Promise((res) => setTimeout(res, 200));
  const slot = (await conn.getSlot("processed")) - 1;
  const [create, key] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  await send("create basket lookup table", [create], []);
  for (let i = 0; i < addresses.length; i += 25) {
    await send("extend basket lookup table", [AddressLookupTableProgram.extendLookupTable({ lookupTable: key, authority: payer.publicKey, payer: payer.publicKey, addresses: addresses.slice(i, i + 25) })], []);
  }
  const s0 = await conn.getSlot();
  while ((await conn.getSlot()) <= s0 + 1) await new Promise((res) => setTimeout(res, 200));
  return (await conn.getAddressLookupTable(key)).value!;
}

async function basketState(basket: PublicKey) {
  return coder.accounts.decode("Basket", (await conn.getAccountInfo(basket))!.data) as any;
}

// ---------------------------------------------------------------- the run
async function main() {
  const slot0 = await conn.getSlot();
  const version = await conn.getVersion();
  transcript.forkStartSlot = slot0;
  transcript.surfpool = version;
  transcript.startedAt = new Date().toISOString();
  console.log("fork slot", slot0);
  const prog = await conn.getAccountInfo(PROGRAM_ID);
  if (!prog?.executable) throw new Error("basket program not deployed on the fork");

  // Real mints, read through the fork from mainnet.
  for (const [name, m] of LEGS) {
    const a = (await conn.getAccountInfo(new PublicKey(m)))!;
    transcript.legs[name] = { mint: m, owner: a.owner.toBase58(), dataLen: a.data.length };
  }

  const authority = payer;
  const alice = kp("fork:alice:" + RUN);
  const shareMint = kp("fork:share:" + RUN);
  const [basket] = PublicKey.findProgramAddressSync([Buffer.from("basket"), shareMint.publicKey.toBuffer()], PROGRAM_ID);
  const vaults = MINTS.map((m) => spl.getAssociatedTokenAddressSync(m, basket, true, T22));
  const reserve = spl.getAssociatedTokenAddressSync(USDC, basket, true, TOKEN);
  transcript.basket = basket.toBase58();
  transcript.shareMint = shareMint.publicKey.toBase58();
  await rpc("requestAirdrop", [alice.publicKey.toBase58(), 100 * 1e9]);

  const alt = await createAlt([PROGRAM_ID, JUP, T22, TOKEN, spl.ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, basket, shareMint.publicKey, USDC, reserve, ...MINTS, ...vaults]);
  transcript.basketLookupTable = alt.key.toBase58();

  // 1. initialize_basket with the REAL PreStocks mints; router allowlist = Jupiter v6.
  const lamports = await conn.getMinimumBalanceForRentExemption(82);
  await send("create share mint", [
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: shareMint.publicKey, space: 82, lamports, programId: TOKEN }),
    spl.createInitializeMint2Instruction(shareMint.publicKey, 9, basket, null, TOKEN),
  ], [shareMint]);
  await send("initialize_basket (7 real PreStocks mints, router = Jupiter v6)", [ix("initialize_basket", {
    payer: payer.publicKey, authority: authority.publicKey, basket, share_mint: shareMint.publicKey, usdc_mint: USDC, usdc_reserve: reserve,
  }, { n_legs: 7, mirror_of: MINTS, max_convert_chunk: bn(10n ** 9n), routers: [JUP] }, MINTS.flatMap((m, i) => [r(m), w(vaults[i])])) ], [], [alt]);

  // 2. bootstrap in kind: 0.01 of each PreStock (≈ $10 each), tokens set on the fork in real ATAs.
  const boot = 10_000_000n;
  for (const m of MINTS) await giveTokens(authority.publicKey, m, T22, boot);
  const authShare = spl.getAssociatedTokenAddressSync(shareMint.publicKey, authority.publicKey, false, TOKEN);
  await send("create share ATAs", [
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, authShare, authority.publicKey, shareMint.publicKey, TOKEN),
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, spl.getAssociatedTokenAddressSync(shareMint.publicKey, alice.publicKey, false, TOKEN), alice.publicKey, shareMint.publicKey, TOKEN),
  ], []);
  await send("bootstrap (in kind, real mints, 1% fee measured)", [ix("bootstrap", {
    depositor: authority.publicKey, basket, share_mint: shareMint.publicKey, depositor_share_ata: authShare,
  }, { gross: MINTS.map(() => bn(boot)) },
  MINTS.flatMap((m, i) => [r(m), w(vaults[i]), w(spl.getAssociatedTokenAddressSync(m, authority.publicKey, false, T22))]))], [], [alt]);
  transcript.afterBootstrap = { vaults: await Promise.all(vaults.map(tokenAmount)) };

  // 3. USDC deposit ticket through live Jupiter routes, output straight into each vault.
  const aliceUsdc = await giveTokens(alice.publicKey, USDC, TOKEN, 1_000_000_000n);
  const nonce = 0;
  const ticket = PublicKey.findProgramAddressSync([Buffer.from("deposit"), basket.toBuffer(), alice.publicKey.toBuffer(), u64le(nonce)], PROGRAM_ID)[0];
  const escrow = spl.getAssociatedTokenAddressSync(USDC, ticket, true, TOKEN);
  transcript.ticket = ticket.toBase58();
  const openIx = ix("open_deposit_ticket", { owner: alice.publicKey, basket, ticket, escrow, owner_usdc: aliceUsdc, usdc_mint: USDC },
    { nonce: bn(nonce), usdc_in: bn(USDC_PER_LEG * 7n), expiry_slots: bn(1500) }, MINTS.flatMap((m, i) => [r(m), r(vaults[i])]));
  await send("open_deposit_ticket", [openIx], [alice], [alt]);

  type LegIx = { leg: number; ix: TransactionInstruction; setup: TransactionInstruction[]; created: PublicKey[]; alts: AddressLookupTableAccount[]; body: any };
  const intermediates: PublicKey[] = [];
  // Hops that failed on this fork are excluded for every leg afterwards (AMM-level fork staleness).
  const excludedAll = new Set<string>();
  const excluded = new Proxy({} as Record<number, string[]>, {
    get: (_t, k) => (typeof k === "string" && /^\d+$/.test(k) ? [...excludedAll] : undefined),
    set: (_t, _k, v: string[]) => { for (const x of v) excludedAll.add(x); return true; },
  });
  const takerOutOf = (i: number) => spl.getAssociatedTokenAddressSync(MINTS[i], ticket, true, T22);
  async function buildLeg(i: number, probe: boolean): Promise<LegIx> {
    const ex = ["Manifest", ...FORK_EXCLUDE, ...(excluded[i] ?? [])].join(",");
    const body = await jupiterBuild({ inputMint: USDC.toBase58(), outputMint: MINTS[i].toBase58(), amount: String(USDC_PER_LEG), taker: ticket.toBase58(), destinationTokenAccount: vaults[i].toBase58(), excludeDexes: ex });
    const takerOut = takerOutOf(i);
    // Probe for Agent B: on the first two legs, do NOT create the taker's own output account (route_v2 index 2).
    const skip = new Set<string>([escrow.toBase58()]);
    if (probe) skip.add(takerOut.toBase58());
    const { ixs: setup, created } = setupIxs(body, ticket, alice.publicKey, skip);
    const minOut = BigInt(body.otherAmountThreshold);
    const swapIx = ix("ticket_swap_leg", { owner: alice.publicKey, basket, ticket, escrow, leg_mint: MINTS[i], leg_vault: vaults[i], router_program: JUP },
      { leg: i, usdc_amount: bn(USDC_PER_LEG), min_out: bn(minOut), route_data: Buffer.from(body.swapInstruction.data, "base64") }, routeAccounts(body));
    transcript.legs[LEGS[i][0]].route = { labels: body.routePlan.map((p: any) => p.swapInfo.label), excludeDexes: ex, outAmount: body.outAmount, minOut: minOut.toString(),
      swapAccounts: body.swapInstruction.accounts.length, takerOutputIndex2: body.swapInstruction.accounts[2]?.pubkey, takerOutputAta: takerOut.toBase58(),
      takerOutputCreated: !skip.has(takerOut.toBase58()), destinationIndex7: body.swapInstruction.accounts[7]?.pubkey, vault: vaults[i].toBase58() };
    return { leg: i, ix: swapIx, setup, created, alts: await jupAlts(body), body };
  }
  /** Label of the AMM hop that failed: the depth-3 program that logged "failed", by its position among the
   *  route's depth-3 invocations. Undefined when the failure is not inside an AMM (e.g. Jupiter's own checks). */
  function failedHop(body: any, logs: string[] = []): string | undefined {
    const amms: string[] = [];
    let failedAt = -1;
    for (const l of logs) {
      const m = l.match(/^Program (\w+) invoke \[3\]/);
      if (m && m[1] !== T22.toBase58() && m[1] !== TOKEN.toBase58()) amms.push(m[1]);
      const f = l.match(/^Program (\w+) failed/);
      if (f && failedAt < 0 && amms.includes(f[1])) failedAt = amms.lastIndexOf(f[1]);
    }
    if (failedAt < 0) return undefined;
    return body.routePlan[failedAt]?.swapInfo?.label;
  }
  async function landAlone(i: number, probe: boolean) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const L = await buildLeg(i, probe && attempt === 0);
      if (L.setup.length) await send(`setup accounts for leg ${i}`, L.setup, [alice], [alt]);
      intermediates.push(...L.created);
      const st = await send(`ticket_swap_leg ${LEGS[i][0]} (alone${probe && attempt === 0 ? ", taker output account NOT created" : ""}, route ${transcript.legs[LEGS[i][0]].route.labels.join(" → ")})`, [L.ix], [alice], [alt, ...L.alts], { tolerate: true });
      if (st.ok) return { L, st };
      const rec = { attempt, route: transcript.legs[LEGS[i][0]].route, error: st.error };
      (transcript.legs[LEGS[i][0]].failures ??= []).push(rec);
      if (probe && attempt === 0) {
        transcript.legs[LEGS[i][0]].takerOutputProbe = { ok: false, error: st.error };
        await send(`create taker output account for leg ${i}`, [spl.createAssociatedTokenAccountIdempotentInstruction(alice.publicKey, takerOutOf(i), ticket, MINTS[i], T22)], [alice]);
        intermediates.push(takerOutOf(i));
        continue;
      }
      const hop = failedHop(L.body, st.logs);
      if (hop) excludedAll.add(hop);
    }
    throw new Error(`leg ${i} could not land`);
  }

  // Each of the first three legs on its own (per-leg CU / accounts / depth).
  const perLeg: any[] = [];
  const landed: LegIx[] = [];
  const v0 = await Promise.all(vaults.map(tokenAmount));
  for (const i of [0, 1, 2]) {
    const { L, st } = await landAlone(i, i < 2);
    landed.push(L);
    const delta = (await tokenAmount(vaults[i])) - v0[i];
    perLeg.push({ leg: LEGS[i][0], signature: st.signature, cu: st.cu, size: st.size, accounts: st.accounts, depth: st.cpiDepth, measuredDelta: delta,
      jupiterOut: L.body.outAmount, minOut: L.body.otherAmountThreshold, route: L.body.routePlan.map((p: any) => p.swapInfo.label), programs: st.programs });
  }
  // The other four: build, then pack as many per transaction as fit (64 account locks, 1232 bytes), send.
  const fits = (group: LegIx[]) => {
    try {
      const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...group.map((g) => g.ix)] })
        .compileToV0Message([alt, ...group.flatMap((g) => g.alts)]);
      const keys = msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
      const size = new VersionedTransaction(msg).serialize().length;
      return { ok: keys <= 64 && size <= 1232, keys, size };
    } catch (e) { return { ok: false, keys: -1, size: -1 }; }
  };
  let remaining = [3, 4, 5, 6];
  const packs: any[] = [];
  for (let round = 0; round < 8 && remaining.length; round++) {
    const built: LegIx[] = [];
    for (const i of remaining) built.push(await buildLeg(i, false));
    for (const L of built) if (L.setup.length) { await send(`setup accounts for leg ${L.leg}`, L.setup, [alice], [alt]); intermediates.push(...L.created); }
    const groups: LegIx[][] = [];
    let cur: LegIx[] = [];
    for (const L of built) { if (fits([...cur, L]).ok) cur.push(L); else { groups.push(cur); cur = [L]; } }
    if (cur.length) groups.push(cur);
    const failed: number[] = [];
    for (const g of groups) {
      const f = fits(g);
      const st = await send(`ticket_swap_leg ×${g.length} packed (${g.map((l) => LEGS[l.leg][0]).join(", ")})`, g.map((x) => x.ix), [alice], [alt, ...g.flatMap((x) => x.alts)], { tolerate: true });
      packs.push({ legs: g.map((x) => LEGS[x.leg][0]), ok: st.ok, signature: st.signature, cu: st.cu, size: st.size, accounts: st.accounts, depth: st.cpiDepth, error: st.error, precomputed: f });
      if (st.ok) {
        landed.push(...g);
        for (const L of g) perLeg.push({ leg: LEGS[L.leg][0], packedWith: g.length, signature: st.signature, txCu: st.cu, size: st.size, accounts: st.accounts, depth: st.cpiDepth,
          measuredDelta: (await tokenAmount(vaults[L.leg])) - v0[L.leg], jupiterOut: L.body.outAmount, minOut: L.body.otherAmountThreshold, route: L.body.routePlan.map((p: any) => p.swapInfo.label) });
      } else {
        const k = Number(String(st.error).match(/Instruction (\d+)/)?.[1] ?? -1); // ix 0 = compute budget
        g.forEach((L, j) => {
          const culprit = k === j + 1;
          (transcript.legs[LEGS[L.leg][0]].failures ??= []).push({ packed: true, culprit, route: L.body.routePlan.map((p: any) => p.swapInfo.label), error: culprit ? st.error : "(another leg in the same transaction failed)" });
          if (culprit) { const hop = failedHop(L.body, st.logs); if (hop) excludedAll.add(hop); }
          failed.push(L.leg);
        });
      }
    }
    remaining = failed;
  }
  if (remaining.length) throw new Error("legs did not land: " + remaining.join(","));
  transcript.ticketLegs = perLeg;
  transcript.packing = packs;

  // Packing analysis with the exact instructions that landed: open + legs + finalize, greedy in leg order,
  // limits 64 account locks and 1232 bytes. (Computed, not sent: every leg above was sent and landed.)
  landed.sort((a, b) => a.leg - b.leg);
  const finIxFor = (extra: PublicKey[]) => ix("finalize_deposit", {
    owner: alice.publicKey, basket, ticket, escrow, owner_usdc: aliceUsdc, share_mint: shareMint.publicKey,
    owner_share_ata: spl.getAssociatedTokenAddressSync(shareMint.publicKey, alice.publicKey, false, TOKEN),
  }, { min_shares: bn(1) }, [...MINTS.flatMap((m, i) => [r(m), r(vaults[i])]), ...extra.map(w)]);
  const measure = (ixs: TransactionInstruction[], alts: AddressLookupTableAccount[]) => {
    try {
      const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs] }).compileToV0Message(alts);
      const keys = msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
      return { keys, size: new VersionedTransaction(msg).serialize().length };
    } catch (e) { return { keys: 999, size: 99999 }; }
  };
  const uniqInter = [...new Set(intermediates.map((x) => x.toBase58()))].map((x) => new PublicKey(x));
  function pack(withOpen: boolean, finExtra: PublicKey[]) {
    type Item = { name: string; ix: TransactionInstruction; alts: AddressLookupTableAccount[] };
    const items: Item[] = [];
    if (withOpen) items.push({ name: "open", ix: openIx, alts: [] });
    for (const L of landed) items.push({ name: LEGS[L.leg][0], ix: L.ix, alts: L.alts });
    items.push({ name: "finalize", ix: finIxFor(finExtra), alts: [] });
    const txs: { items: string[]; keys: number; size: number }[] = [];
    let cur: Item[] = [];
    const m = (g: Item[]) => measure(g.map((x) => x.ix), [alt, ...g.flatMap((x) => x.alts)]);
    for (const it of items) {
      const t = m([...cur, it]);
      if (t.keys <= 64 && t.size <= 1232) cur.push(it);
      else { const f = m(cur); txs.push({ items: cur.map((x) => x.name), ...f }); cur = [it]; }
    }
    if (cur.length) txs.push({ items: cur.map((x) => x.name), ...m(cur) });
    return txs;
  }
  transcript.packingAnalysis = {
    note: "greedy in leg order over the instructions that landed on the fork; basket lookup table + Jupiter's lookup tables",
    perLegAlone: landed.map((L) => ({ leg: LEGS[L.leg][0], ...measure([L.ix], [alt, ...L.alts]), routeAccounts: L.body.swapInstruction.accounts.length })),
    depositWithIntermediatesClosed: pack(true, uniqInter),
    depositIntermediatesNotPassed: pack(true, []),
    intermediates: uniqInter.length,
  };
  console.log("packing:", JSON.stringify(transcript.packingAnalysis.depositWithIntermediatesClosed.map((t: any) => `${t.items.join("+")} ${t.keys}acc ${t.size}B`)));

  // finalize: mints shares, refunds leftover USDC, closes every ticket-owned intermediate account.
  const aliceShare = spl.getAssociatedTokenAddressSync(shareMint.publicKey, alice.publicKey, false, TOKEN);
  const interLive = [];
  for (const k of [...new Set(intermediates.map((x) => x.toBase58()))].map((x) => new PublicKey(x))) if (await conn.getAccountInfo(k)) interLive.push(k);
  transcript.intermediatesClosedByFinalize = interLive.map((k) => k.toBase58());
  const fin = await send("finalize_deposit (closes ticket-owned intermediates)", [ix("finalize_deposit", {
    owner: alice.publicKey, basket, ticket, escrow, owner_usdc: aliceUsdc, share_mint: shareMint.publicKey, owner_share_ata: aliceShare,
  }, { min_shares: bn(1) }, [...MINTS.flatMap((m, i) => [r(m), r(vaults[i])]), ...interLive.map(w)])], [alice], [alt]);
  transcript.finalize = { shares: (await tokenAmount(aliceShare)).toString(), events: fin.events, intermediatesStillOpen: (await Promise.all(interLive.map((k) => conn.getAccountInfo(k)))).filter(Boolean).length };

  // 3b. The full deposit as a client would send it: open + 7 legs (each with its ticket-owned account setup)
  //     + finalize, packed greedily into as few transactions as fit (64 locks, 1232 bytes), all sent.
  //     A route that fails on the fork (stale prop-AMM state) aborts that attempt: its hop is excluded for
  //     that leg and the whole deposit restarts on a fresh ticket. Every attempt is recorded.
  transcript.fullDepositAttempts = [];
  transcript.forkRouteFailures = [];
  for (let attempt = 0; attempt < 8 && !transcript.fullDeposit; attempt++) {
    const nonce2 = 1 + attempt;
    const t2 = PublicKey.findProgramAddressSync([Buffer.from("deposit"), basket.toBuffer(), alice.publicKey.toBuffer(), u64le(nonce2)], PROGRAM_ID)[0];
    const esc2 = spl.getAssociatedTokenAddressSync(USDC, t2, true, TOKEN);
    const open2 = ix("open_deposit_ticket", { owner: alice.publicKey, basket, ticket: t2, escrow: esc2, owner_usdc: aliceUsdc, usdc_mint: USDC },
      { nonce: bn(nonce2), usdc_in: bn(USDC_PER_LEG * 7n), expiry_slots: bn(1500) }, MINTS.flatMap((m, i) => [r(m), r(vaults[i])]));
    type Unit = { name: string; ixs: TransactionInstruction[]; alts: AddressLookupTableAccount[]; created: PublicKey[]; body?: any; leg?: number };
    const inter2: PublicKey[] = [];
    const units: Unit[] = [{ name: "open", ixs: [open2], alts: [], created: [] }];
    for (let i = 0; i < 7; i++) {
      const ex = ["Manifest", ...FORK_EXCLUDE, ...(excluded[i] ?? [])].join(",");
      const body = await jupiterBuild({ inputMint: USDC.toBase58(), outputMint: MINTS[i].toBase58(), amount: String(USDC_PER_LEG), taker: t2.toBase58(), destinationTokenAccount: vaults[i].toBase58(), excludeDexes: ex });
      const { ixs: setup, created } = setupIxs(body, t2, alice.publicKey, new Set([esc2.toBase58()]));
      const sw = ix("ticket_swap_leg", { owner: alice.publicKey, basket, ticket: t2, escrow: esc2, leg_mint: MINTS[i], leg_vault: vaults[i], router_program: JUP },
        { leg: i, usdc_amount: bn(USDC_PER_LEG), min_out: bn(BigInt(body.otherAmountThreshold)), route_data: Buffer.from(body.swapInstruction.data, "base64") }, routeAccounts(body));
      units.push({ name: LEGS[i][0], ixs: [...setup, sw], alts: await jupAlts(body), created, body, leg: i });
      inter2.push(...created);
    }
    units.push({ name: "finalize", alts: [], created: [], ixs: [ix("finalize_deposit", {
      owner: alice.publicKey, basket, ticket: t2, escrow: esc2, owner_usdc: aliceUsdc, share_mint: shareMint.publicKey, owner_share_ata: aliceShare,
    }, { min_shares: bn(1) }, [...MINTS.flatMap((m, i) => [r(m), r(vaults[i])]), ...[...new Set(inter2.map((x) => x.toBase58()))].map((x) => w(new PublicKey(x)))])] });
    const m2 = (g: Unit[]) => {
      try {
        const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...g.flatMap((u) => u.ixs)] })
          .compileToV0Message([alt, ...g.flatMap((u) => u.alts)]);
        return { keys: msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0), size: new VersionedTransaction(msg).serialize().length };
      } catch { return { keys: 999, size: 99999 }; }
    };
    const groups: Unit[][] = [];
    let cur: Unit[] = [];
    for (const u of units) { const t = m2([...cur, u]); if (t.keys <= 64 && t.size <= 1232) cur.push(u); else { groups.push(cur); cur = [u]; } }
    if (cur.length) groups.push(cur);
    const sent: any[] = [];
    let failed = false;
    for (const g of groups) {
      const pre = m2(g);
      const st = await send(`full deposit (attempt ${attempt + 1}) tx ${sent.length + 1}/${groups.length}: ${g.map((u) => u.name).join(" + ")}`, g.flatMap((u) => u.ixs), [alice], [alt, ...g.flatMap((u) => u.alts)], { tolerate: true });
      sent.push({ items: g.map((u) => u.name), ok: st.ok, signature: st.signature, slot: st.slot, cu: st.cu, size: st.size, accounts: st.accounts, precomputed: pre, depth: st.cpiDepth, error: st.error?.slice(0, 160),
        routes: g.filter((u) => u.body).map((u) => `${u.name}: ${u.body.routePlan.map((p: any) => p.swapInfo.label).join(" → ")}`) });
      if (!st.ok) {
        // Which unit failed: "Instruction k" counts the compute-budget ix as 0.
        const k = Number(String(st.error).match(/Instruction (\d+)/)?.[1] ?? -1);
        let idx = 1;
        for (const u of g) {
          if (k >= idx && k < idx + u.ixs.length && u.leg !== undefined) {
            const hop = failedHop(u.body, st.logs);
            transcript.forkRouteFailures.push({ leg: u.name, route: u.body.routePlan.map((p: any) => p.swapInfo.label), failedHop: hop, error: String(st.error).match(/(custom program error: 0x[0-9a-f]+|Unsupported program id)/)?.[1] });
            if (hop) excludedAll.add(hop);
          }
          idx += u.ixs.length;
        }
        failed = true;
        break;
      }
    }
    const rec = { attempt: attempt + 1, ticket: t2.toBase58(), plannedTransactions: groups.length, sent, ok: !failed };
    transcript.fullDepositAttempts.push(rec);
    if (!failed) {
      transcript.fullDeposit = { ...rec, ticketClosed: !(await conn.getAccountInfo(t2)), sharesAfter: (await tokenAmount(aliceShare)).toString(),
        intermediatesClosed: [...new Set(inter2.map((x) => x.toBase58()))].length,
        intermediatesOpen: (await Promise.all([...new Set(inter2.map((x) => x.toBase58()))].map((x) => conn.getAccountInfo(new PublicKey(x))))).filter(Boolean).length };
      console.log("full deposit:", JSON.stringify(sent.map((x) => `${x.items.join("+")} ${x.accounts}acc ${x.size}B ${x.cu}cu`)));
    }
    save();
  }
  if (!transcript.fullDeposit) throw new Error("full deposit did not complete");

  // 4. USDC-mode redemption: every leg becomes a PendingSale claim; settle_leg_usdc sells each via Jupiter,
  //    the basket PDA as taker, USDC straight to the owner.
  const shares = await tokenAmount(aliceShare);
  const rt = PublicKey.findProgramAddressSync([Buffer.from("redeem"), basket.toBuffer(), alice.publicKey.toBuffer(), u64le(0)], PROGRAM_ID)[0];
  await send("redeem (Usdc mode: 7 PendingSale claims)", [ix("redeem", {
    owner: alice.publicKey, basket, share_mint: shareMint.publicKey, owner_share_ata: aliceShare, ticket: rt, usdc_reserve: null, owner_usdc: null,
  }, { nonce: bn(0), shares: bn(shares / 2n), mode: { Usdc: { min_usdc_out: bn(0) } } }, MINTS.flatMap((m, i) => [r(m), w(vaults[i]), r(PROGRAM_ID)]))], [alice], [alt]);
  const settles: any[] = [];
  for (let i = 0; i < 7; i++) {
    const st = await basketState(basket);
    const sup = (await conn.getParsedAccountInfo(shareMint.publicKey)) as any;
    const S = BigInt(sup.value.data.parsed.info.supply);
    const bal = await tokenAmount(vaults[i]);
    const l = st.legs[i];
    const pending = (BigInt(l.pending_norm.toString()) * BigInt(l.loss_index.toString())) / 10n ** 18n;
    const amount = ((shares / 2n) * (bal - pending)) / (S + BigInt(l.claim_units.toString()));
    const ex: string[] = ["Manifest", ...FORK_EXCLUDE, ...excludedAll];
    const tries: any[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const body = await jupiterBuild({ inputMint: MINTS[i].toBase58(), outputMint: USDC.toBase58(), amount: amount.toString(), taker: basket.toBase58(), destinationTokenAccount: aliceUsdc.toBase58(), excludeDexes: ex.join(",") });
      const { ixs: setup } = setupIxs(body, basket, alice.publicKey, new Set([vaults[i].toBase58(), aliceUsdc.toBase58()]));
      if (setup.length) await send(`setup basket-owned route accounts for settle leg ${i}`, setup, [alice], [alt]);
      const u0 = await tokenAmount(aliceUsdc);
      const minUsdc = BigInt(body.otherAmountThreshold);
      const s = await send(`settle_leg_usdc ${LEGS[i][0]} (route ${body.routePlan.map((p: any) => p.swapInfo.label).join(" → ")})`, [ix("settle_leg_usdc", {
        owner: alice.publicKey, basket, ticket: rt, leg_mint: MINTS[i], leg_vault: vaults[i], owner_usdc: aliceUsdc, router_program: JUP, share_mint: shareMint.publicKey,
      }, { leg: i, min_usdc_out: bn(minUsdc), route_data: Buffer.from(body.swapInstruction.data, "base64") }, routeAccounts(body))], [alice], [alt, ...(await jupAlts(body))], { tolerate: true });
      const rec = { leg: LEGS[i][0], attempt, ok: s.ok, signature: s.signature, amount, cu: s.cu, size: s.size, accounts: s.accounts, depth: s.cpiDepth,
        usdcReceived: s.ok ? (await tokenAmount(aliceUsdc)) - u0 : 0n, jupiterOut: body.outAmount, minUsdc, route: body.routePlan.map((p: any) => p.swapInfo.label),
        excludeDexes: ex.join(","), error: s.error, reserveInRoute: body.swapInstruction.accounts.some((a: any) => a.pubkey === reserve.toBase58()),
        takerOutputIndex2: body.swapInstruction.accounts[2]?.pubkey };
      tries.push(rec);
      if (s.ok) break;
      const hop = failedHop(body, s.logs);
      if (hop) { ex.push(hop); excludedAll.add(hop); }
    }
    settles.push(...tries);
  }
  transcript.settleLegUsdc = settles;

  // 5. IPO rule: flag a listing, travel 7 days on the fork, convert a chunk through Jupiter into the reserve,
  //    then reinvest (the leg retires only when fully converted; here one chunk proves the CPI path).
  const L = 3; // ANDURIL
  const now = BigInt((await conn.getBlockTime(await conn.getSlot()))!);
  await send("flag_listing ANDURIL (≥ 7 d notice)", [ix("flag_listing", { authority: authority.publicKey, basket }, { leg: L, convert_after: bn(now + 7n * 86400n + 60n), deadline: bn(now + 14n * 86400n + 60n) })], []);
  const early = await send("convert_listed_leg before convert_after (must fail)", [ix("convert_listed_leg", {
    cranker: payer.publicKey, basket, leg_mint: MINTS[L], leg_vault: vaults[L], usdc_mint: USDC, usdc_reserve: reserve, router_program: JUP,
  }, { leg: L, amount: bn(1000), min_usdc_out: bn(1), route_data: Buffer.alloc(0) }, [])], [], [alt], { expectFail: true });
  transcript.convertBeforeNotice = { ok: early.ok, error: early.error };
  const tt = await rpc("surfnet_timeTravel", [{ absoluteTimestamp: Number(now + 8n * 86400n) * 1000 }]).catch(async () => rpc("surfnet_timeTravel", [{ absoluteTimestamp: Number(now + 8n * 86400n) }]));
  transcript.timeTravel = tt;
  SLIPPAGE_BPS = "500";
  transcript.slippageAfterTimeTravel = SLIPPAGE_BPS;
  const bal = await tokenAmount(vaults[L]);
  const chunk = bal / 2n;
  const cex: string[] = ["Manifest", ...FORK_EXCLUDE, ...excludedAll];
  transcript.convertAttempts = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const cbody = await jupiterBuild({ inputMint: MINTS[L].toBase58(), outputMint: USDC.toBase58(), amount: chunk.toString(), taker: basket.toBase58(), excludeDexes: cex.join(",") });
    const { ixs: csetup } = setupIxs(cbody, basket, payer.publicKey, new Set([vaults[L].toBase58(), reserve.toBase58()]));
    if (csetup.length) await send("setup basket-owned route accounts for convert", csetup, [], [alt]);
    const r0 = await tokenAmount(reserve);
    const conv = await send(`convert_listed_leg ANDURIL chunk → USDC reserve (route ${cbody.routePlan.map((p: any) => p.swapInfo.label).join(" → ")})`, [ix("convert_listed_leg", {
      cranker: payer.publicKey, basket, leg_mint: MINTS[L], leg_vault: vaults[L], usdc_mint: USDC, usdc_reserve: reserve, router_program: JUP,
    }, { leg: L, amount: bn(chunk), min_usdc_out: bn(BigInt(cbody.otherAmountThreshold)), route_data: Buffer.from(cbody.swapInstruction.data, "base64") }, routeAccounts(cbody))], [], [alt, ...(await jupAlts(cbody))], { tolerate: true });
    const rec = { attempt, ok: conv.ok, signature: conv.signature, chunk, usdcIntoReserve: (await tokenAmount(reserve)) - r0, cu: conv.cu, size: conv.size, accounts: conv.accounts, depth: conv.cpiDepth,
      route: cbody.routePlan.map((p: any) => p.swapInfo.label), jupiterOut: cbody.outAmount, error: conv.error };
    transcript.convertAttempts.push(rec);
    if (conv.ok) { transcript.convert = rec; break; }
    const hop = failedHop(cbody, conv.logs);
    if (hop) { cex.push(hop); excludedAll.add(hop); }
  }
  if (!transcript.convert) throw new Error("convert did not succeed");
  // Convert the rest of the leg (one more chunk ≤ max_convert_chunk): the leg retires; then reinvest the reserve
  // into the six remaining legs in equal slices through Jupiter, output measured into each vault.
  {
    const stR = await basketState(basket);
    const lr = stR.legs[L];
    const pend = (BigInt(lr.pending_norm.toString()) * BigInt(lr.loss_index.toString())) / 10n ** 18n;
    const rest = (await tokenAmount(vaults[L])) - pend;
    const ex2: string[] = ["Manifest", ...FORK_EXCLUDE, ...cex.slice(1 + FORK_EXCLUDE.length)];
    transcript.convertRestAttempts = [];
    for (let attempt = 0; attempt < 6 && !transcript.convertRest; attempt++) {
      const b2 = await jupiterBuild({ inputMint: MINTS[L].toBase58(), outputMint: USDC.toBase58(), amount: rest.toString(), taker: basket.toBase58(), excludeDexes: ex2.join(",") });
      const r0 = await tokenAmount(reserve);
      const st2 = await send(`convert_listed_leg ANDURIL remainder → reserve (route ${b2.routePlan.map((p: any) => p.swapInfo.label).join(" → ")})`, [ix("convert_listed_leg", {
        cranker: payer.publicKey, basket, leg_mint: MINTS[L], leg_vault: vaults[L], usdc_mint: USDC, usdc_reserve: reserve, router_program: JUP,
      }, { leg: L, amount: bn(rest), min_usdc_out: bn(1), route_data: Buffer.from(b2.swapInstruction.data, "base64") }, routeAccounts(b2))], [], [alt, ...(await jupAlts(b2))], { tolerate: true });
      const rec = { attempt, ok: st2.ok, signature: st2.signature, amount: rest, usdcIntoReserve: (await tokenAmount(reserve)) - r0, cu: st2.cu, depth: st2.cpiDepth, route: b2.routePlan.map((p: any) => p.swapInfo.label), events: st2.events?.map((e: any) => e.name), error: st2.error };
      transcript.convertRestAttempts.push(rec);
      if (st2.ok) transcript.convertRest = rec;
      else { const hop = failedHop(b2, st2.logs); if (hop) ex2.push(hop); }
    }
    const stAfter = await basketState(basket);
    transcript.afterConversion = { status: stAfter.legs[L].status, reinvestMask: stAfter.reinvest_mask, reserve: (await tokenAmount(reserve)).toString() };
    transcript.reinvest = [];
    if (stAfter.legs[L].status.Retired) {
      for (const i of [0, 1, 2, 4, 5, 6]) {
        for (let attempt = 0; attempt < 6; attempt++) {
          const st = await basketState(basket);
          const left = BigInt(Number(st.reinvest_mask).toString(2).split("").filter((c) => c === "1").length);
          const res0 = await tokenAmount(reserve);
          const slice = left === 1n ? res0 : res0 / left;
          const ex3 = ["Manifest", ...FORK_EXCLUDE, ...excludedAll, ...(transcript.reinvest.filter((x: any) => x.leg === LEGS[i][0] && x.failedHop).map((x: any) => x.failedHop))];
          const b3 = await jupiterBuild({ inputMint: USDC.toBase58(), outputMint: MINTS[i].toBase58(), amount: slice.toString(), taker: basket.toBase58(), excludeDexes: ex3.join(",") });
          const vb = await tokenAmount(vaults[i]);
          const st3 = await send(`reinvest_reserve → ${LEGS[i][0]} (slice ${slice}, route ${b3.routePlan.map((p: any) => p.swapInfo.label).join(" → ")})`, [ix("reinvest_reserve", {
            cranker: payer.publicKey, basket, usdc_mint: USDC, usdc_reserve: reserve, leg_mint: MINTS[i], leg_vault: vaults[i], router_program: JUP,
          }, { leg: i, usdc_amount: bn(slice), min_out: bn(BigInt(b3.otherAmountThreshold)), route_data: Buffer.from(b3.swapInstruction.data, "base64") }, routeAccounts(b3))], [], [alt, ...(await jupAlts(b3))], { tolerate: true });
          transcript.reinvest.push({ leg: LEGS[i][0], attempt, ok: st3.ok, signature: st3.signature, slice, measuredDelta: (await tokenAmount(vaults[i])) - vb, jupiterOut: b3.outAmount, minOut: b3.otherAmountThreshold,
            cu: st3.cu, size: st3.size, accounts: st3.accounts, depth: st3.cpiDepth, route: b3.routePlan.map((p: any) => p.swapInfo.label), error: st3.error, failedHop: st3.ok ? undefined : failedHop(b3, st3.logs) });
          if (st3.ok) break;
        }
      }
      const fin2 = await basketState(basket);
      transcript.afterReinvest = { reinvestMask: fin2.reinvest_mask, reserve: (await tokenAmount(reserve)).toString() };
    }
  }
  const bs = await basketState(basket);
  transcript.convert.legStatus = bs.legs[L].status;
  transcript.convert.reserveAccounted = bs.accounted_usdc_reserve.toString();
  transcript.excludedOnFork = { always: ["Manifest", ...FORK_EXCLUDE], learnedFromFailures: [...excludedAll] };
  transcript.finishedAt = new Date().toISOString();
  transcript.forkEndSlot = await conn.getSlot();
  save();
  console.log("done; transcript", `transcript-${RUN}.json`);
}

main().catch((e) => { transcript.fatal = String(e.stack ?? e); save(); console.error(e); process.exit(1); });
