// Local validator for the app's e2e: "local, not devnet — built, not verified".
//
//   npx tsx e2e/local/setup.ts --basket-so <basket.so> --basket-id <program id> [--amm-so <fixture_amm.so>]
//
// Port 8903 ONLY (8899/8901 belong to other agents). Everything is created fresh:
//  - keys: deployer (basket authority and payer) and a local fixture issuer, in e2e/.local/keys;
//  - seven Token-2022 fixture mints with the PreStocks extension set, created with the same
//    spl-token flags Agent C uses on devnet (scripts/fixtures/create-mints.ts on `ops`), fee
//    100 bps now with 300 bps scheduled two epochs out (mirrors mainnet on 2026-09-25);
//  - fixture USDC (classic, 6 decimals); the share mint (classic, 9 decimals, authority = basket PDA);
//  - initialize_basket + bootstrap through this repo's SDK;
//  - optionally fixture_amm pools (Agent C's program, built from branch `ops`).
// Writes public/config.json for the app and e2e/.local/env.json for the test.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, SystemProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createMintToCheckedInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as sdk from "@stocklana/sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "../..");
const LOCAL = join(APP, "e2e/.local");
export const RPC = "http://127.0.0.1:8903";
const T22 = sdk.TOKEN_2022_PROGRAM_ID;
const TOK = sdk.TOKEN_PROGRAM_ID;

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

function sh(cmd: string, args: string[], opts: { json?: boolean } = {}): any {
  const out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return opts.json ? JSON.parse(out) : out;
}
function keyfile(name: string): { kp: Keypair; path: string } {
  const path = join(LOCAL, "keys", `${name}.json`);
  if (!existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey])); }
  return { kp: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))), path };
}
export function splToken(args: string[], feePayer: string): any {
  return sh("spl-token", [...args, "-u", RPC, "--fee-payer", feePayer, "--output", "json"], { json: true });
}

async function startValidator(programs: { id: string; so: string; authority: string }[]) {
  const pidFile = join(LOCAL, "validator.pid");
  if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM"); } catch {} await new Promise((r) => setTimeout(r, 1500)); }
  rmSync(join(LOCAL, "ledger"), { recursive: true, force: true });
  mkdirSync(LOCAL, { recursive: true });
  const args = ["--reset", "--quiet", "--ledger", join(LOCAL, "ledger"), "--rpc-port", "8903", "--faucet-port", "9903", "--gossip-port", "8913",
    "--dynamic-port-range", "8920-8990", "--bind-address", "127.0.0.1", "--limit-ledger-size", "5000000"];
  for (const p of programs) args.push("--upgradeable-program", p.id, p.so, p.authority);
  const log = openSync(join(LOCAL, "validator.log"), "w");
  const child = spawn("solana-test-validator", args, { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  const conn = new Connection(RPC, "confirmed");
  for (let i = 0; i < 120; i++) {
    try { await conn.getSlot(); return conn; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error("validator did not start on 8903; see e2e/.local/validator.log");
}

async function send(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
}

async function main() {
  const basketSo = arg("basket-so"), basketId = arg("basket-id");
  if (!basketSo || !basketId) throw new Error("--basket-so and --basket-id are required");
  const deployer = keyfile("deployer"), issuer = keyfile("issuer");
  const programs = [{ id: basketId, so: resolve(basketSo), authority: deployer.kp.publicKey.toBase58() }];
  const ammSo = arg("amm-so");
  const ammId = ammSo ? keyfile("fixture-amm-program").kp.publicKey.toBase58() : null;
  if (ammSo && ammId) programs.push({ id: ammId, so: resolve(ammSo), authority: deployer.kp.publicKey.toBase58() });
  const conn = await startValidator(programs);
  const sigs: Record<string, string[]> = {};
  const rec = (k: string, s: string) => { (sigs[k] ??= []).push(s); };
  for (const k of [deployer, issuer]) await conn.confirmTransaction(await conn.requestAirdrop(k.kp.publicKey, 100 * LAMPORTS_PER_SOL), "confirmed");

  // ---- fixture mints (same flags as Agent C's devnet script)
  const legs: { symbol: string; mint: PublicKey; mirrorOf: PublicKey }[] = [];
  for (const c of sdk.CONSTITUENTS) {
    const created = splToken(["create-token", "--program-2022", "--decimals", "9", "--transfer-fee-basis-points", "100",
      "--transfer-fee-maximum-fee", "18446744073.709551615", "--enable-permanent-delegate", "--enable-pause", "--enable-freeze",
      "--default-account-state", "initialized", "--enable-transfer-hook", "--ui-amount-multiplier", "1", "--enable-metadata",
      "--enable-confidential-transfers", "auto", "--mint-authority", issuer.kp.publicKey.toBase58()], issuer.path);
    const mint = new PublicKey(created.commandOutput.address);
    rec(`create ${c.symbol}`, created.commandOutput.transactionData.signature);
    sh("spl-token", ["initialize-metadata", mint.toBase58(), `${c.name} (local fixture)`, c.symbol, "https://example.invalid", "--mint-authority", issuer.path,
      "--update-authority", issuer.kp.publicKey.toBase58(), "-u", RPC, "--fee-payer", issuer.path]);
    if (c.symbol === "OPENAI") {
      sh("spl-token", ["update-ui-amount-multiplier", mint.toBase58(), "1.4861347", String(Math.floor(Date.now() / 1000) + 5), "--ui-multiplier-authority", issuer.path, "-u", RPC, "--fee-payer", issuer.path]);
    }
    // 100 → 300 bps two epochs out, as mainnet on 2026-09-25.
    sh("spl-token", ["set-transfer-fee", mint.toBase58(), "300", "18446744073.709551615", "--transfer-fee-authority", issuer.path, "-u", RPC, "--fee-payer", issuer.path]);
    legs.push({ symbol: c.symbol, mint, mirrorOf: new PublicKey(c.mainnetMint) });
    console.log(`${c.symbol}: ${mint.toBase58()}`);
  }
  const usdc = new PublicKey(splToken(["create-token", "--decimals", "6", "--mint-authority", issuer.kp.publicKey.toBase58(), "--program-id", TOK.toBase58()], issuer.path).commandOutput.address);

  // ---- share mint: classic, 9 decimals, mint authority = basket PDA, no freeze authority
  const programId = new PublicKey(basketId);
  const shareMintKp = Keypair.generate();
  const [basket] = sdk.basketPda(programId, shareMintKp.publicKey);
  writeFileSync(join(LOCAL, "keys/share-mint.json"), JSON.stringify([...shareMintKp.secretKey]));
  splToken(["create-token", join(LOCAL, "keys/share-mint.json"), "--decimals", "9", "--mint-authority", basket.toBase58(), "--program-id", TOK.toBase58()], deployer.path);

  // ---- initialize_basket
  const legAccts = legs.map((l) => ({ mint: l.mint, vault: sdk.legVault(basket, l.mint) }));
  const routers = ammId ? [new PublicKey(ammId)] : [];
  const init = sdk.ix.initializeBasket({ programId, payer: deployer.kp.publicKey, authority: deployer.kp.publicKey, basket, shareMint: shareMintKp.publicKey,
    usdcMint: usdc, usdcReserve: sdk.ata(basket, usdc, TOK), legs: legAccts, mirrorOf: legs.map((l) => l.mirrorOf), maxConvertChunk: 10n ** 10n, routers });
  rec("initialize_basket", await send(conn, [sdk.computeBudget(1_000_000)[0], init.ix], [deployer.kp]));

  // ---- bootstrap: deployer deposits 100 of every leg (local placeholder for "equal value": no prices locally)
  const boot = 100n * 10n ** 9n;
  const dAtas = legs.map((l) => getAssociatedTokenAddressSync(l.mint, deployer.kp.publicKey, false, T22));
  await send(conn, legs.flatMap((l, i) => [
    createAssociatedTokenAccountIdempotentInstruction(issuer.kp.publicKey, dAtas[i], deployer.kp.publicKey, l.mint, T22),
    createMintToCheckedInstruction(l.mint, dAtas[i], issuer.kp.publicKey, 10n * boot, 9, [], T22),
  ]).slice(0, 8), [issuer.kp]);
  await send(conn, legs.flatMap((l, i) => [
    createAssociatedTokenAccountIdempotentInstruction(issuer.kp.publicKey, dAtas[i], deployer.kp.publicKey, l.mint, T22),
    createMintToCheckedInstruction(l.mint, dAtas[i], issuer.kp.publicKey, 10n * boot, 9, [], T22),
  ]).slice(8), [issuer.kp]);
  const shareAta = sdk.ata(deployer.kp.publicKey, shareMintKp.publicKey, TOK);
  const bootIx = sdk.ix.bootstrap({ programId, depositor: deployer.kp.publicKey, basket, shareMint: shareMintKp.publicKey, depositorShareAta: shareAta,
    legs: legs.map((l, i) => ({ mint: l.mint, vault: legAccts[i].vault, userTokenAccount: dAtas[i] })), gross: legs.map(() => boot) });
  rec("bootstrap", await send(conn, [sdk.computeBudget(1_000_000)[0],
    createAssociatedTokenAccountIdempotentInstruction(deployer.kp.publicKey, shareAta, deployer.kp.publicKey, shareMintKp.publicKey, TOK), bootIx.ix], [deployer.kp]));

  // ---- fixture_amm pools (optional): vaults owned by the pool PDA, seeded by minting into them
  const pools: string[] = [];
  if (ammId) {
    const amm = new PublicKey(ammId);
    for (const l of legs) {
      const pool = sdk.poolPda(amm, l.mint);
      const legVault = getAssociatedTokenAddressSync(l.mint, pool, true, T22);
      const usdcVault = getAssociatedTokenAddressSync(usdc, pool, true, TOK);
      const initPool = new TransactionInstruction({ programId: amm, data: Buffer.from([0, 30, 0]), keys: [
        { pubkey: deployer.kp.publicKey, isSigner: true, isWritable: true }, { pubkey: issuer.kp.publicKey, isSigner: true, isWritable: false },
        { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: l.mint, isSigner: false, isWritable: false }, { pubkey: usdc, isSigner: false, isWritable: false },
        { pubkey: legVault, isSigner: false, isWritable: false }, { pubkey: usdcVault, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] });
      rec(`pool ${l.symbol}`, await send(conn, [
        createAssociatedTokenAccountIdempotentInstruction(deployer.kp.publicKey, legVault, pool, l.mint, T22),
        createAssociatedTokenAccountIdempotentInstruction(deployer.kp.publicKey, usdcVault, pool, usdc, TOK),
        createMintToCheckedInstruction(l.mint, legVault, issuer.kp.publicKey, 10_000n * 10n ** 9n, 9, [], T22),
        createMintToCheckedInstruction(usdc, usdcVault, issuer.kp.publicKey, 1_000_000n * 10n ** 6n, 6, [], TOK),
        initPool], [deployer.kp, issuer.kp]));
      pools.push(pool.toBase58());
    }
  }

  const env = {
    rpc: RPC, programId: programId.toBase58(), shareMint: shareMintKp.publicKey.toBase58(), basket: basket.toBase58(), usdc: usdc.toBase58(),
    legs: legs.map((l) => ({ symbol: l.symbol, mint: l.mint.toBase58() })), issuerKey: issuer.path, deployerKey: deployer.path,
    fixtureAmm: ammId, pools, setupSignatures: sigs, createdAt: new Date().toISOString(),
    programs: {
      basket: { id: basketId, builtFrom: arg("basket-commit") ?? "unknown", sha256: createHash("sha256").update(readFileSync(basketSo)).digest("hex") },
      fixtureAmm: ammSo ? { id: ammId, builtFrom: arg("amm-commit") ?? "unknown", sha256: createHash("sha256").update(readFileSync(ammSo)).digest("hex") } : null,
    },
  };
  writeFileSync(join(LOCAL, "env.json"), JSON.stringify(env, null, 2));
  // Registry in Agent C's format (fixtures/registry.json schema 1), so C's valuation API can be run
  // locally against this validator: CLUSTER=local LOCAL_RPC=http://127.0.0.1:8903 REGISTRY=<this file>.
  writeFileSync(join(LOCAL, "registry.json"), JSON.stringify({
    schema: 1, cluster: "local", fixture_issuer: issuer.kp.publicKey.toBase58(), token_2022_program: T22.toBase58(),
    legs: legs.map((l, i) => ({ index: i, symbol: l.symbol, mint: l.mint.toBase58(), mirror_of: l.mirrorOf.toBase58(), decimals: 9, token_program: T22.toBase58(), complete: true })),
    usdc: { mint: usdc.toBase58(), decimals: 6, token_program: TOK.toBase58(), mirror_of: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", mint_authority: issuer.kp.publicKey.toBase58() },
    // pools: [] because C's entries carry seed provenance (mainnet price source) that local pools don't have.
    fixture_amm: ammId ? { program_id: ammId, lp_fee_bps: 30, pools: [], local_pools: legs.map((l, i) => ({ index: i, symbol: l.symbol, pool: pools[i] })) } : null,
    hook_program: null,
  }, null, 2));
  mkdirSync(join(APP, "public"), { recursive: true });
  writeFileSync(join(APP, "public/config.json"), JSON.stringify({
    cluster: "localnet", clusterLabel: "local validator, not devnet", rpcUrl: RPC, programId: env.programId, shareMint: env.shareMint,
    lookupTable: null, valuationApiUrl: arg("valuation-url") ?? null, router: ammId ? { kind: "fixture_amm", programId: ammId } : { kind: "none" },
    upgradeAuthority: deployer.kp.publicKey.toBase58(), explorerTx: null,
  }, null, 2));
  console.log(`basket ${env.basket} ready on ${RPC}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
