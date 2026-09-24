// LOCAL ONLY. Proves fixture_amm works as the basket's router through CPI:
//  - a program PDA is the taker (signs via invoke_signed, never at top level);
//  - output lands in an arbitrary token account owned by a different PDA (like a basket vault);
//  - Token-2022 transfer_checked runs one level below the router (probe -> amm -> token-2022).
// Measured deltas must equal quoteSwap() to the unit, and the logs must show the CPI depths.
//
//   node scripts/amm/cpi-probe-test.ts   (requires fixtures/cpi-probe deployed on the local validator)

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, TransactionInstruction } from "../../services/valuation/src/lib/web3.ts";
import { poolAccounts, ixSwap, ixCreateAtaIdempotent, ixMintToChecked, quoteSwap, SIDE_BUY, SIDE_SELL, ata } from "../../services/valuation/src/lib/amm.ts";
import { feeSchedule, TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";
import { loadRegistry, writeJson, loadKeypair, ISSUER_KEY, REPO, rpcFor, nowIso } from "../lib/env.ts";
import { send, connection } from "../lib/tx.ts";

const c = "local" as const;
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const usdc = reg.usdc;
const amm = reg.fixture_amm;
const probe = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(REPO, "fixtures", "target", "deploy", "cpi_probe-keypair.json"), "utf8")))).publicKey;
const [taker, bump] = PublicKey.findProgramAddressSync([Buffer.from("taker")], probe);
// A stand-in basket vault owner: another off-curve address.
const [vaultOwner] = PublicKey.findProgramAddressSync([Buffer.from("vault-owner")], probe);

function viaProbe(inner: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: probe,
    data: Buffer.concat([Buffer.from([bump]), inner.data]),
    keys: [
      { pubkey: inner.programId, isSigner: false, isWritable: false },
      ...inner.keys.map((k) => ({ ...k, isSigner: k.pubkey.equals(taker) ? false : k.isSigner })),
    ],
  });
}

async function bal(addrs: string[]) {
  const r = await rpc.accounts(addrs);
  return r.values.map((x) => (x ? BigInt(x.data.parsed.info.tokenAmount.amount) : 0n));
}

async function run() {
  const leg = reg.legs[0];
  const a = poolAccounts(amm.program_id, leg.mint, usdc.mint, usdc.token_program);
  const takerUsdc = ixCreateAtaIdempotent(issuer.publicKey, taker, usdc.mint, usdc.token_program);
  const takerLeg = ixCreateAtaIdempotent(issuer.publicKey, taker, leg.mint, TOKEN_2022_PROGRAM);
  const vault = ixCreateAtaIdempotent(issuer.publicKey, vaultOwner, leg.mint, TOKEN_2022_PROGRAM);
  const vaultUsdc = ixCreateAtaIdempotent(issuer.publicKey, vaultOwner, usdc.mint, usdc.token_program);
  const usdcIn = 250_000_000n; // 250 USDC
  await send(c, "setup PDA accounts and fund PDA taker", [takerUsdc.ix, takerLeg.ix, vault.ix, vaultUsdc.ix, ixMintToChecked(usdc.token_program, usdc.mint, takerUsdc.address, issuer.publicKey, usdcIn, 6)], [issuer]);

  const epoch = (await rpc.epochInfo()).epoch;
  const fee = feeSchedule((await rpc.account(leg.mint)).value.data.parsed.info, epoch)!;

  // Buy: PDA taker pays USDC, leg lands in the vault owned by a different PDA.
  let pre = await bal([a.legVault.toBase58(), a.usdcVault.toBase58(), vault.address.toBase58()]);
  const qb = quoteSwap({ side: SIDE_BUY, amountIn: usdcIn, legReserve: pre[0], usdcReserve: pre[1], lpFeeBps: amm.lp_fee_bps, legFeeBps: fee.now_bps });
  const buyIx = ixSwap({ program: amm.program_id, legMint: leg.mint, usdcMint: usdc.mint, taker, source: takerUsdc.address, destination: vault.address, amountIn: usdcIn, minOut: qb.delivered, side: SIDE_BUY, usdcTokenProgram: usdc.token_program });
  const buy = await send(c, "probe -> fixture_amm buy (PDA taker, output to other PDA's vault)", [viaProbe(buyIx)], [issuer]);
  let post = await bal([a.legVault.toBase58(), a.usdcVault.toBase58(), vault.address.toBase58()]);
  const buyMeasured = post[2] - pre[2];

  // Sell: mint leg to the PDA taker, sell it, USDC to the other PDA's USDC account.
  const legIn = 100_000_000n; // 0.1 token
  await send(c, "mint leg to PDA taker", [ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, takerLeg.address, issuer.publicKey, legIn, 9)], [issuer]);
  pre = await bal([a.legVault.toBase58(), a.usdcVault.toBase58(), vaultUsdc.address.toBase58()]);
  const qs = quoteSwap({ side: SIDE_SELL, amountIn: legIn, legReserve: pre[0], usdcReserve: pre[1], lpFeeBps: amm.lp_fee_bps, legFeeBps: fee.now_bps });
  const sellIx = ixSwap({ program: amm.program_id, legMint: leg.mint, usdcMint: usdc.mint, taker, source: takerLeg.address, destination: vaultUsdc.address, amountIn: legIn, minOut: qs.delivered, side: SIDE_SELL, usdcTokenProgram: usdc.token_program });
  const sell = await send(c, "probe -> fixture_amm sell (PDA taker)", [viaProbe(sellIx)], [issuer]);
  post = await bal([a.legVault.toBase58(), a.usdcVault.toBase58(), vaultUsdc.address.toBase58()]);
  const sellMeasured = post[2] - pre[2];

  // Negative control: the same swap without the PDA signature must fail (the router must not move a taker's funds unsigned).
  const conn = connection(c);
  const logs = (await conn.getTransaction(buy.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))?.meta?.logMessages ?? [];
  const depths = logs.filter((l) => / invoke \[\d\]/.test(l));
  const { simulate } = await import("../lib/tx.ts");
  const unsigned = await simulate(c, [new TransactionInstruction({ programId: new PublicKey(amm.program_id), data: buyIx.data, keys: buyIx.keys.map((k) => ({ ...k, isSigner: false })) })], [issuer]);

  const result = {
    cluster: c, at: nowIso(), probe_program: probe.toBase58(), pda_taker: taker.toBase58(), destination_owner_pda: vaultOwner.toBase58(), leg: leg.symbol, fee_bps_in_force: fee.now_bps,
    buy: { signature: buy.signature, slot: buy.slot, quoted: qb.delivered.toString(), measured: buyMeasured.toString(), match: buyMeasured === qb.delivered },
    sell: { signature: sell.signature, slot: sell.slot, quoted: qs.delivered.toString(), measured: sellMeasured.toString(), match: sellMeasured === qs.delivered },
    cpi_invoke_lines: depths,
    negative_control_unsigned_taker: { err: unsigned.err, expected: "MissingRequiredSignature from fixture_amm" },
  };
  writeJson(join(REPO, "fixtures", ".local", "cpi-probe.json"), result);
  console.log(JSON.stringify({ buy: result.buy, sell: result.sell, depths, unsigned: unsigned.err }, null, 1));
  if (!result.buy.match || !result.sell.match || !unsigned.err) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
