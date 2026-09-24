// Fund a (fresh) test wallet with fixture USDC and every fixture leg, for app e2e tests.
//
//   node scripts/fixtures/fund-wallet.ts --cluster devnet --wallet <pubkey> [--usdc 200] [--leg-usd 20 | --leg-raw <n>] [--sol 0.02]
//
// - fixture USDC: `--usdc` whole USDC (MintToChecked into the wallet's ATA);
// - each leg: `--leg-usd` dollars' worth at its fixture_amm pool price (MintToChecked, so no transfer fee);
// - SOL for fees: `--sol` transferred from the fixture issuer (default 0: devnet SOL is scarce).
// The fixture issuer pays and signs. Signatures are appended to fixtures/scenarios/funding.json.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { PublicKey, SystemProgram } from "../../services/valuation/src/lib/web3.ts";
import { ixCreateAtaIdempotent, ixMintToChecked } from "../../services/valuation/src/lib/amm.ts";
import { TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, loadRegistry, loadKeypair, ISSUER_KEY, rpcFor, scenarioDir, readJson, writeJson, nowIso } from "../lib/env.ts";
import { send } from "../lib/tx.ts";

const c = cluster();
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const walletArg = arg("wallet");
if (!walletArg) throw new Error("--wallet <pubkey> required");
const wallet = new PublicKey(walletArg);
const usdc = BigInt(Math.round(Number(arg("usdc", "200")) * 1e6));
const legUsd = Number(arg("leg-usd", "20"));
const legRaw = arg("leg-raw") ? BigInt(arg("leg-raw")!) : null; // exact raw amount per leg, overrides --leg-usd
const sol = Number(arg("sol", "0"));

async function run() {
  const sigs = [];
  const u = ixCreateAtaIdempotent(issuer.publicKey, wallet, reg.usdc.mint, reg.usdc.token_program);
  const first = [u.ix, ixMintToChecked(reg.usdc.token_program, reg.usdc.mint, u.address, issuer.publicKey, usdc, 6)];
  if (sol > 0) first.push(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: wallet, lamports: Math.round(sol * 1e9) }));
  sigs.push(await send(c, `fund ${usdc} raw fixture USDC${sol ? ` + ${sol} SOL` : ""}`, first, [issuer]));

  const legs: any[] = [];
  const pools = reg.fixture_amm?.pools ?? [];
  const ixs = [];
  for (const leg of reg.legs) {
    const pool = pools.find((p: any) => p.index === leg.index);
    let usdPerRaw = pool?.seed?.usd_per_raw_target;
    if (pool) {
      const r = await rpc.accounts([pool.leg_vault, pool.usdc_vault]);
      const l = Number(r.values[0].data.parsed.info.tokenAmount.amount), q = Number(r.values[1].data.parsed.info.tokenAmount.amount);
      if (l && q) usdPerRaw = q / 1e6 / l;
    }
    if (!usdPerRaw) throw new Error(`${leg.symbol}: no pool price`);
    const raw = legRaw ?? BigInt(Math.floor(legUsd / usdPerRaw));
    const a = ixCreateAtaIdempotent(issuer.publicKey, wallet, leg.mint, TOKEN_2022_PROGRAM);
    ixs.push(a.ix, ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, a.address, issuer.publicKey, raw, leg.decimals));
    legs.push({ index: leg.index, symbol: leg.symbol, mint: leg.mint, account: a.address.toBase58(), raw: raw.toString(), usd_per_raw: usdPerRaw });
  }
  for (let i = 0; i < ixs.length; i += 8) sigs.push(await send(c, "fund fixture legs (mint_to)", ixs.slice(i, i + 8), [issuer]));

  const path = join(scenarioDir(c), "funding.json");
  const file = existsSync(path) ? readJson(path) : { what: "Test wallets funded with fixture USDC and legs by the fixture issuer", cluster: c, runs: [] };
  file.runs.push({ at: nowIso(), actor: arg("actor", "ops"), wallet: wallet.toBase58(), usdc_raw: usdc.toString(), sol, legs, signatures: sigs });
  writeJson(path, file);
  console.log(JSON.stringify({ wallet: wallet.toBase58(), usdc_raw: usdc.toString(), legs: legs.map((l) => `${l.symbol} ${l.raw}`), signatures: sigs.map((s) => s.signature) }, null, 1));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
