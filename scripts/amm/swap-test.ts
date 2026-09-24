// Prove fixture_amm swaps deliver exactly what the client-side maths predicts, to the unit, in both
// directions and to a destination owned by someone other than the taker.
//
//   node scripts/amm/swap-test.ts --cluster local|devnet [--usdc 100]
//
// Per leg: mint `--usdc` fixture USDC to the issuer; buy the leg with it, delivering to a token
// account owned by a fresh key (not the taker); then sell what the issuer holds back to USDC.
// Each swap's destination delta is measured from chain state and compared to quoteSwap() computed
// from reserves and the fee in force read just before. A mismatch fails the run.
// Writes fixtures/amm/swaps.<cluster>.json.

import { join } from "node:path";
import { Keypair, PublicKey } from "../../services/valuation/src/lib/web3.ts";
import { poolAccounts, ixSwap, ixCreateAtaIdempotent, ixMintToChecked, quoteSwap, SIDE_BUY, SIDE_SELL, ata } from "../../services/valuation/src/lib/amm.ts";
import { feeSchedule, TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, loadRegistry, writeJson, loadKeypair, ISSUER_KEY, REPO, rpcFor, nowIso } from "../lib/env.ts";
import { send } from "../lib/tx.ts";

const c = cluster();
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const usdc = reg.usdc;
const amm = reg.fixture_amm;
const usdcIn = BigInt(Math.round(Number(arg("usdc", "100")) * 1e6));
const recipient = Keypair.generate().publicKey; // an unrelated owner: output goes to *its* account

async function amounts(addrs: string[]) {
  const r = await rpc.accounts(addrs);
  return { slot: r.slot, v: r.values.map((x) => (x ? BigInt(x.data.parsed.info.tokenAmount.amount) : 0n)) };
}

async function run() {
  const out: any = { cluster: c, program: amm.program_id, started_at: nowIso(), recipient_owner: recipient.toBase58(), legs: [] };
  let failures = 0;
  const issuerUsdc = ata(issuer.publicKey, usdc.mint, usdc.token_program);
  await send(c, "fund issuer USDC", [
    ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, usdc.mint, usdc.token_program).ix,
    ixMintToChecked(usdc.token_program, usdc.mint, issuerUsdc, issuer.publicKey, usdcIn * BigInt(reg.legs.length), 6),
  ], [issuer]);

  for (const leg of reg.legs) {
    const a = poolAccounts(amm.program_id, leg.mint, usdc.mint, usdc.token_program);
    const issuerLeg = ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, leg.mint, TOKEN_2022_PROGRAM);
    const recvLeg = ixCreateAtaIdempotent(issuer.publicKey, recipient, leg.mint, TOKEN_2022_PROGRAM);
    await send(c, "create ATAs", [issuerLeg.ix, recvLeg.ix], [issuer]);

    const epoch = (await rpc.epochInfo()).epoch;
    const mint = (await rpc.account(leg.mint)).value.data.parsed.info;
    const fee = feeSchedule(mint, epoch)!;

    // 1. Buy: USDC from the issuer, leg delivered to the unrelated recipient's account.
    let pre = await amounts([a.legVault.toBase58(), a.usdcVault.toBase58(), recvLeg.address.toBase58()]);
    const qb = quoteSwap({ side: SIDE_BUY, amountIn: usdcIn, legReserve: pre.v[0], usdcReserve: pre.v[1], lpFeeBps: amm.lp_fee_bps, legFeeBps: fee.now_bps });
    const buy = await send(c, `swap buy ${leg.symbol}`, [ixSwap({ program: amm.program_id, legMint: leg.mint, usdcMint: usdc.mint, taker: issuer.publicKey, source: issuerUsdc, destination: recvLeg.address, amountIn: usdcIn, minOut: qb.delivered, side: SIDE_BUY, usdcTokenProgram: usdc.token_program })], [issuer]);
    let post = await amounts([a.legVault.toBase58(), a.usdcVault.toBase58(), recvLeg.address.toBase58()]);
    const buyDelivered = post.v[2] - pre.v[2];
    const buyOk = buyDelivered === qb.delivered && pre.v[0] - post.v[0] === qb.pool_out && post.v[1] - pre.v[1] === usdcIn;

    // 2. Sell: give the issuer some leg (mint), then sell it for USDC into the issuer's USDC account.
    const legIn = qb.pool_out; // same size as the buy, so the round trip shows both fees
    await send(c, "mint leg to issuer for the sell test", [ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, issuerLeg.address, issuer.publicKey, legIn, 9)], [issuer]);
    pre = await amounts([a.legVault.toBase58(), a.usdcVault.toBase58(), issuerUsdc.toBase58()]);
    const qs = quoteSwap({ side: SIDE_SELL, amountIn: legIn, legReserve: pre.v[0], usdcReserve: pre.v[1], lpFeeBps: amm.lp_fee_bps, legFeeBps: fee.now_bps });
    const sell = await send(c, `swap sell ${leg.symbol}`, [ixSwap({ program: amm.program_id, legMint: leg.mint, usdcMint: usdc.mint, taker: issuer.publicKey, source: issuerLeg.address, destination: issuerUsdc, amountIn: legIn, minOut: qs.delivered, side: SIDE_SELL, usdcTokenProgram: usdc.token_program })], [issuer]);
    post = await amounts([a.legVault.toBase58(), a.usdcVault.toBase58(), issuerUsdc.toBase58()]);
    const sellDelivered = post.v[2] - pre.v[2];
    const sellOk = sellDelivered === qs.delivered && post.v[0] - pre.v[0] === qs.pool_received && pre.v[1] - post.v[1] === qs.pool_out;

    if (!buyOk || !sellOk) failures++;
    const row = {
      symbol: leg.symbol, fee_bps_in_force: fee.now_bps, epoch,
      buy: { signature: buy.signature, slot: buy.slot, usdc_in: usdcIn.toString(), quoted_delivered: qb.delivered.toString(), measured_delivered: buyDelivered.toString(), leg_fee_withheld: qb.out_fee.toString(), destination: recvLeg.address.toBase58(), match: buyOk },
      sell: { signature: sell.signature, slot: sell.slot, leg_in: legIn.toString(), quoted_delivered: qs.delivered.toString(), measured_delivered: sellDelivered.toString(), leg_fee_withheld: qs.in_fee.toString(), match: sellOk },
    };
    out.legs.push(row);
    console.log(`${leg.symbol} fee ${fee.now_bps}bps: buy quoted ${qb.delivered} measured ${buyDelivered} ${buyOk ? "OK" : "MISMATCH"}; sell quoted ${qs.delivered} measured ${sellDelivered} ${sellOk ? "OK" : "MISMATCH"}`);
  }
  out.finished_at = nowIso();
  out.all_match = failures === 0;
  writeJson(join(REPO, "fixtures", c === "devnet" ? "amm" : ".local", `swaps.${c}.json`), out);
  if (failures) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
