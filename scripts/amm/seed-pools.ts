// Create and seed one fixture_amm pool per fixture leg, at the mirrored mainnet token's last-trade price.
//
//   node scripts/amm/seed-pools.ts --cluster local|devnet [--lp-fee-bps 25] [--reseed]
//
// Price source: Jupiter price v3 `usdPricePrescaled` for the mainnet mint (USD per unscaled token,
// i.e. per 10^9 raw units). Pool reserves are set so that
//     usdc_reserve_raw / leg_reserve_raw = usdPricePrescaled * 10^6 / 10^9
// with the USDC side = half of Jupiter's reported liquidity for that token (so price impact is of the
// same order as mainnet's for small sizes; a constant-product curve is not a DLMM, and this is stated).
// Reserves are minted straight into the pool vaults (MintTo pays no transfer fee). --reseed moves an
// existing pool back onto the current mainnet price (admin_withdraw the excess, mint the shortfall).
// Every source figure and signature is recorded in the registry under fixture_amm.pools[i].seed.

import { statSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "../../services/valuation/src/lib/web3.ts";
import { poolAccounts, ixInitPool, ixCreateAtaIdempotent, ixMintToChecked, ixAdminWithdraw, ata } from "../../services/valuation/src/lib/amm.ts";
import { jupiterLastTrade } from "../../services/valuation/src/lib/sources.ts";
import { TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, flag, loadRegistry, registryPath, writeJson, loadKeypair, ISSUER_KEY, KEY_DIR, REPO, rpcFor, nowIso } from "../lib/env.ts";
import { send } from "../lib/tx.ts";

const c = cluster();
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const programId = arg("program") ?? loadKeypair(join(KEY_DIR, "fixture-amm-program.json")).publicKey.toBase58();
const lpFeeBps = Number(arg("lp-fee-bps", "25"));
const usdc = reg.usdc;

async function run() {
  const prog = await rpc.account(programId, "base64");
  if (!prog.value?.executable) throw new Error(`fixture_amm ${programId} is not deployed on ${c}`);
  const programData = await rpc.call("getAccountInfo", [programId, { encoding: "jsonParsed" }]);
  const pdAddr = programData.value?.data?.parsed?.info?.programData;
  const pd = pdAddr ? (await rpc.account(pdAddr)).value?.data?.parsed?.info : null;
  let soSize: number | null = null;
  try { soSize = statSync(join(REPO, "fixtures", "target", "deploy", "fixture_amm.so")).size; } catch {}

  reg.fixture_amm = {
    ...(reg.fixture_amm ?? {}),
    program_id: programId,
    upgrade_authority: pd?.authority ?? null,
    so_size_bytes: soSize,
    lp_fee_bps: lpFeeBps,
    pools: reg.fixture_amm?.pools ?? [],
  };

  const prices = await jupiterLastTrade(reg.legs.map((l: any) => l.mirror_of));
  for (const leg of reg.legs) {
    const p = prices[leg.mirror_of];
    if (!p) throw new Error(`${leg.symbol}: no Jupiter price`);
    const a = poolAccounts(programId, leg.mint, usdc.mint, usdc.token_program);
    const existing = reg.fixture_amm.pools.find((x: any) => x.index === leg.index);
    const poolInfo = await rpc.account(a.pool.toBase58(), "base64");
    const sigs: any[] = [];

    if (!poolInfo.value) {
      const legV = ixCreateAtaIdempotent(issuer.publicKey, a.pool, leg.mint, TOKEN_2022_PROGRAM);
      const usdcV = ixCreateAtaIdempotent(issuer.publicKey, a.pool, usdc.mint, usdc.token_program);
      sigs.push(await send(c, "create pool vaults + init_pool", [legV.ix, usdcV.ix, ixInitPool(programId, issuer.publicKey, issuer.publicKey, leg.mint, usdc.mint, lpFeeBps, usdc.token_program)], [issuer]));
    } else if (existing && !flag("reseed")) {
      console.log(`${leg.symbol}: pool exists (${a.pool.toBase58()}); pass --reseed to re-centre`);
      continue;
    }

    const targetUsdc = BigInt(Math.floor((p.liquidity_usd / 2) * 1e6));
    const targetLeg = BigInt(Math.floor((Number(targetUsdc) / 1e6 / p.usd_per_unscaled_token) * 1e9));
    const bal = await rpc.accounts([a.legVault.toBase58(), a.usdcVault.toBase58()]);
    const curLeg = BigInt(bal.values[0].data.parsed.info.tokenAmount.amount);
    const curUsdc = BigInt(bal.values[1].data.parsed.info.tokenAmount.amount);

    const ixs = [];
    const issuerLegAta = ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, leg.mint, TOKEN_2022_PROGRAM);
    const issuerUsdcAta = ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, usdc.mint, usdc.token_program);
    if (curLeg > targetLeg || curUsdc > targetUsdc) ixs.push(issuerLegAta.ix, issuerUsdcAta.ix);
    if (curLeg < targetLeg) ixs.push(ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, a.legVault, issuer.publicKey, targetLeg - curLeg, 9));
    if (curLeg > targetLeg) ixs.push(ixAdminWithdraw(programId, issuer.publicKey, leg.mint, usdc.mint, 0, ata(issuer.publicKey, leg.mint, TOKEN_2022_PROGRAM), curLeg - targetLeg, usdc.token_program));
    if (curUsdc < targetUsdc) ixs.push(ixMintToChecked(usdc.token_program, usdc.mint, a.usdcVault, issuer.publicKey, targetUsdc - curUsdc, 6));
    if (curUsdc > targetUsdc) ixs.push(ixAdminWithdraw(programId, issuer.publicKey, leg.mint, usdc.mint, 1, ata(issuer.publicKey, usdc.mint, usdc.token_program), curUsdc - targetUsdc, usdc.token_program));
    if (ixs.length) sigs.push(await send(c, curLeg || curUsdc ? "re-centre reserves on mainnet price" : "seed reserves (mint_to into pool vaults)", ixs, [issuer]));

    const after = await rpc.accounts([a.legVault.toBase58(), a.usdcVault.toBase58()]);
    const legRes = BigInt(after.values[0].data.parsed.info.tokenAmount.amount);
    const usdcRes = BigInt(after.values[1].data.parsed.info.tokenAmount.amount);
    const record = {
      index: leg.index,
      symbol: leg.symbol,
      leg_mint: leg.mint,
      pool: a.pool.toBase58(),
      leg_vault: a.legVault.toBase58(),
      usdc_vault: a.usdcVault.toBase58(),
      seed: {
        source: p.source,
        mainnet_mint: leg.mirror_of,
        jupiter: { usdPrice: p.usd_per_ui, usdPricePrescaled: p.usd_per_unscaled_token, blockId: p.block, liquidity: p.liquidity_usd, fetched_at: p.fetched_at },
        usd_per_raw_target: p.usd_per_raw,
        reserves_after: { leg_raw: legRes.toString(), usdc_raw: usdcRes.toString(), slot: after.slot },
        pool_usd_per_raw: Number(usdcRes) / 1e6 / Number(legRes),
        seeded_at: nowIso(),
        signatures: sigs,
      },
    };
    reg.fixture_amm.pools = reg.fixture_amm.pools.filter((x: any) => x.index !== leg.index).concat([record]).sort((x: any, y: any) => x.index - y.index);
    writeJson(registryPath(c), reg);
    console.log(`${leg.symbol}: pool ${record.pool} leg ${legRes} usdc ${usdcRes} -> $${(record.seed.pool_usd_per_raw * 1e9).toFixed(4)}/token (jup ${p.usd_per_unscaled_token.toFixed(4)}, block ${p.block})`);
  }
  reg.updated_at = nowIso();
  writeJson(registryPath(c), reg);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
