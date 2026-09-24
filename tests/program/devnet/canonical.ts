// The canonical devnet basket (spec 00): Agent C's fixture mints and fixture USDC from fixtures/registry.json,
// C's fixture_amm in the router allowlist, bootstrapped in kind by the basket authority with the fixture legs
// C sent to it. Usage: node --import tsx devnet/canonical.ts <registry.json> [--init-only]
// Writes tests/program/devnet/canonical.json with every signature.
import {
  AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, AddressLookupTableAccount,
} from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import BN from "bn.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { ix } from "../src/basket.ts";
import { PROGRAM_ID, ROOT, T22, TOKEN, coder, kp, parseEvents } from "../src/env.ts";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
let lastCall = 0;
async function politeFetch(input: any, init?: any): Promise<Response> {
  for (let k = 0; ; k++) {
    const wait = lastCall + 150 - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    lastCall = Date.now();
    try { const res = await fetch(input, init); if (res.status !== 429 || k >= 30) return res; } catch (e) { if (k >= 30) throw e; }
    await new Promise((ok) => setTimeout(ok, Math.min(30_000, 1_000 * 2 ** Math.min(k, 5))));
  }
}
const conn = new Connection(RPC, { commitment: "confirmed", fetch: politeFetch as any, disableRetryOnRateLimit: true });
const OUT = path.join(ROOT, "tests/program/devnet/canonical.json");
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME!, ".config/solana/stocklana/program.json"), "utf8"))));
const reg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bn = (x: bigint | number) => new BN(x.toString());

/** Tolerant registry reading: legs sorted by index; USDC; fixture_amm program id. */
const legs = [...(reg.legs ?? [])].sort((a: any, b: any) => a.index - b.index);
const MINTS: PublicKey[] = legs.map((l: any) => new PublicKey(l.mint));
const MIRROR: PublicKey[] = legs.map((l: any) => new PublicKey(l.mirror_of ?? l.mirrorOf ?? l.mainnet_mint ?? l.mint));
const USDC = new PublicKey(reg.usdc?.mint ?? reg.usdc);
const AMM = new PublicKey(reg.fixture_amm?.program_id ?? reg.fixture_amm?.programId ?? reg.fixture_amm ?? reg.amm?.program_id ?? reg.fixture_amm_program_id);
const SUFFIX = process.env.CANONICAL_SUFFIX ?? "v1";
const shareMint = kp(`canonical:share:${SUFFIX}`);
const [basket] = PublicKey.findProgramAddressSync([Buffer.from("basket"), shareMint.publicKey.toBuffer()], PROGRAM_ID);
const vaults = MINTS.map((m) => spl.getAssociatedTokenAddressSync(m, basket, true, T22));
const reserve = spl.getAssociatedTokenAddressSync(USDC, basket, true, TOKEN);
const rec: any = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { steps: [] };
Object.assign(rec, { cluster: "devnet", program: PROGRAM_ID.toBase58(), basket: basket.toBase58(), shareMint: shareMint.publicKey.toBase58(),
  authority: authority.publicKey.toBase58(), usdcMint: USDC.toBase58(), usdcReserve: reserve.toBase58(), routers: [AMM.toBase58()],
  legs: legs.map((l: any, i: number) => ({ symbol: l.symbol ?? l.name, mint: MINTS[i].toBase58(), vault: vaults[i].toBase58(), mirror_of: MIRROR[i].toBase58() })),
  registry: { source: process.argv[2], commit: process.env.REGISTRY_COMMIT } });
const save = () => fs.writeFileSync(OUT, JSON.stringify(rec, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1));

async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[] = [], alts: AddressLookupTableAccount[] = []) {
  let prev: string | undefined;
  for (let attempt = 0; ; attempt++) {
    if (prev) {
      const st = (await conn.getSignatureStatuses([prev], { searchTransactionHistory: true })).value[0];
      if (st && !st.err && st.confirmationStatus) return done(label, prev);
    }
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: authority.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...ixs] }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg);
    const need = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).map((k) => k.toBase58());
    tx.sign([authority, ...signers].filter((k) => need.includes(k.publicKey.toBase58())));
    try {
      prev = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 });
      for (;;) {
        const st = (await conn.getSignatureStatuses([prev])).value[0];
        if (st?.err) throw Object.assign(new Error(`${label}: ${JSON.stringify(st.err)}`), { landed: true });
        if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return done(label, prev);
        if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("block height exceeded");
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } catch (e: any) {
      if (!e.landed && attempt < 5 && /blockhash|429|block height exceeded|fetch failed/i.test(String(e.message))) continue;
      rec.steps.push({ label, ok: false, error: String(e.message).slice(0, 400), logs: e.logs });
      save();
      throw e;
    }
  }
}
async function done(label: string, sig: string) {
  const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  rec.steps.push({ label, signature: sig, slot: t?.slot, events: parseEvents(t?.meta?.logMessages ?? []).map((e) => ({ name: e.name, data: e.data })) });
  save();
  console.log(`${label}: ${sig}`);
  return sig;
}

async function main() {
  if (!(await conn.getAccountInfo(PROGRAM_ID))?.executable) throw new Error("program not deployed");
  // Lookup table: programs, basket, mints, vaults, USDC (for B's clients too).
  let alt: AddressLookupTableAccount | null = rec.lookupTable ? (await conn.getAddressLookupTable(new PublicKey(rec.lookupTable))).value : null;
  if (!alt) {
    const slot = await conn.getSlot("confirmed");
    const [create, key] = AddressLookupTableProgram.createLookupTable({ authority: authority.publicKey, payer: authority.publicKey, recentSlot: slot - 1 });
    await send("create basket lookup table", [create]);
    rec.lookupTable = key.toBase58();
    save();
    await send("extend basket lookup table", [AddressLookupTableProgram.extendLookupTable({ lookupTable: key, authority: authority.publicKey, payer: authority.publicKey,
      addresses: [PROGRAM_ID, AMM, T22, TOKEN, spl.ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId, basket, shareMint.publicKey, USDC, reserve, ...MINTS, ...vaults] })]);
    await new Promise((ok) => setTimeout(ok, 3000));
    alt = (await conn.getAddressLookupTable(key)).value!;
  }
  if (!(await conn.getAccountInfo(basket))) {
    await send("create share mint (authority = basket PDA) and the authority's share account", [
      SystemProgram.createAccount({ fromPubkey: authority.publicKey, newAccountPubkey: shareMint.publicKey, space: 82, lamports: await conn.getMinimumBalanceForRentExemption(82), programId: TOKEN }),
      spl.createInitializeMint2Instruction(shareMint.publicKey, 9, basket, null, TOKEN),
      spl.createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, spl.getAssociatedTokenAddressSync(shareMint.publicKey, authority.publicKey), authority.publicKey, shareMint.publicKey),
    ], [shareMint]);
    await send("initialize_basket (C's fixture mints, router allowlist = fixture_amm)", [ix("initialize_basket", {
      payer: authority.publicKey, authority: authority.publicKey, basket, share_mint: shareMint.publicKey, usdc_mint: USDC, usdc_reserve: reserve,
    }, { n_legs: MINTS.length, mirror_of: MIRROR, max_convert_chunk: bn(10n ** 12n), routers: [AMM] }, MINTS.flatMap((m, i) => [{ pubkey: m, isSigner: false, isWritable: false }, { pubkey: vaults[i], isSigner: false, isWritable: true }]))], [], [alt]);
  }
  if (process.argv.includes("--init-only")) return;
  const st = coder.accounts.decode("Basket", (await conn.getAccountInfo(basket))!.data) as any;
  if (!st.bootstrapped) {
    const gross: bigint[] = [];
    for (const m of MINTS) gross.push((await conn.getTokenAccountBalance(spl.getAssociatedTokenAddressSync(m, authority.publicKey, false, T22))).value.amount as any);
    rec.bootstrapGross = gross.map(String);
    if (gross.some((g) => BigInt(g) === 0n)) throw new Error("the authority holds no tokens of some leg: " + rec.bootstrapGross.join(","));
    await send("bootstrap (in kind, INITIAL_SHARES)", [ix("bootstrap", { depositor: authority.publicKey, basket, share_mint: shareMint.publicKey,
      depositor_share_ata: spl.getAssociatedTokenAddressSync(shareMint.publicKey, authority.publicKey) }, { gross: gross.map((g) => bn(BigInt(g))) },
    MINTS.flatMap((m, i) => [{ pubkey: m, isSigner: false, isWritable: false }, { pubkey: vaults[i], isSigner: false, isWritable: true },
      { pubkey: spl.getAssociatedTokenAddressSync(m, authority.publicKey, false, T22), isSigner: false, isWritable: true }]))], [], [alt]);
  }
  rec.vaultBalances = await Promise.all(vaults.map(async (v) => (await conn.getTokenAccountBalance(v)).value.amount));
  rec.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ basket: rec.basket, shareMint: rec.shareMint, lookupTable: rec.lookupTable, program: rec.program }));
}
main().catch((e) => { console.error(e); process.exit(1); });
