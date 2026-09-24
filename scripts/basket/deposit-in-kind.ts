// Get shares of a basket (A's program) for a holder key, by an in-kind deposit sized to the basket's
// current per-share composition. The fixture issuer mints the legs to the holder first (mint_to, no fee).
//
//   node scripts/basket/deposit-in-kind.ts --cluster devnet --idl <basket.json> --share-mint <mint> \
//     --shares <raw target> [--holder ~/.config/solana/stocklana/ops.json]
//
// gross_i = ceil(target * owned_i / (S + C_i) / (1 - fee_i)) + 1, so every leg's net delta covers the
// target; the program mints min over legs (spec 01). min_shares = 99% of target.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { PublicKey } from "../../services/valuation/src/lib/web3.ts";
import { loadIdl, decodeAccount } from "../../services/valuation/src/lib/idl.ts";
import { basketPda, ixDeposit } from "../../services/valuation/src/lib/basket-client.ts";
import { ixCreateAtaIdempotent, ixMintToChecked, ata } from "../../services/valuation/src/lib/amm.ts";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, feeSchedule } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, loadRegistry, loadKeypair, ISSUER_KEY, KEY_DIR, rpcFor, scenarioDir, readJson, writeJson, nowIso } from "../lib/env.ts";
import { send } from "../lib/tx.ts";

const c = cluster();
const idl = loadIdl(arg("idl")!);
const shareMint = arg("share-mint")!;
const target = BigInt(arg("shares")!);
const holder = loadKeypair(arg("holder", join(KEY_DIR, "ops.json"))!.replace(/^~/, homedir()));
const issuer = loadKeypair(ISSUER_KEY);
const reg = loadRegistry(c);
const rpc = rpcFor(c);

async function run() {
  const basket = basketPda(idl.address, shareMint).toBase58();
  const [b, sm, ep] = await Promise.all([rpc.account(basket, "base64"), rpc.account(shareMint), rpc.epochInfo()]);
  const st = decodeAccount(idl, "Basket", Buffer.from(b.value.data[0], "base64"));
  const S = BigInt(sm.value.data.parsed.info.supply);
  const legs = st.legs.slice(0, st.n_legs);
  const vaults = await rpc.accounts(legs.map((l: any) => l.vault));
  const mints = await rpc.accounts(legs.map((l: any) => l.mint));
  const gross: bigint[] = legs.map((l: any, i: number) => {
    const B = BigInt(vaults.values[i].data.parsed.info.tokenAmount.amount);
    const owned = B - (BigInt(l.pending_norm) * BigInt(l.loss_index)) / 10n ** 18n;
    const fee = feeSchedule(mints.values[i].data.parsed.info, ep.epoch)!.now_bps;
    const need = (target * owned + (S + BigInt(l.claim_units)) - 1n) / (S + BigInt(l.claim_units));
    return (need * 10_000n + BigInt(10_000 - fee) - 1n) / BigInt(10_000 - fee) + 1n;
  });
  const sigs = [];
  const fund = [ixCreateAtaIdempotent(issuer.publicKey, holder.publicKey, shareMint, TOKEN_PROGRAM).ix];
  legs.forEach((l: any, i: number) => {
    fund.push(ixCreateAtaIdempotent(issuer.publicKey, holder.publicKey, l.mint, TOKEN_2022_PROGRAM).ix);
    fund.push(ixMintToChecked(TOKEN_2022_PROGRAM, l.mint, ata(holder.publicKey, l.mint, TOKEN_2022_PROGRAM), issuer.publicKey, gross[i], 9));
  });
  for (let i = 0; i < fund.length; i += 8) sigs.push(await send(c, "fund holder with fixture legs (mint_to)", fund.slice(i, i + 8), [issuer]));
  const legRefs = legs.map((l: any) => ({ mint: l.mint }));
  sigs.push(await send(c, `deposit_in_kind target ${target} raw shares`, [ixDeposit(idl, "deposit_in_kind", { depositor: holder.publicKey.toBase58(), shareMint, legs: legRefs, gross, minShares: (target * 99n) / 100n })], [holder], 1_400_000));
  const after = await rpc.account(ata(holder.publicKey, shareMint, TOKEN_PROGRAM).toBase58());
  const path = join(scenarioDir(c), "holder-deposits.json");
  const file = existsSync(path) ? readJson(path) : { what: "In-kind deposits into the basket by ops-held keys (to hold shares for redeem checks)", cluster: c, runs: [] };
  file.runs.push({ at: nowIso(), program: idl.address, basket, share_mint: shareMint, holder: holder.publicKey.toBase58(), target_shares_raw: target.toString(), gross: gross.map(String), shares_after_raw: after.value?.data?.parsed?.info?.tokenAmount?.amount, signatures: sigs });
  writeJson(path, file);
  console.log(`holder ${holder.publicKey.toBase58()} shares ${after.value?.data?.parsed?.info?.tokenAmount?.amount}; deposit ${sigs[sigs.length - 1].signature} @${sigs[sigs.length - 1].slot}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
