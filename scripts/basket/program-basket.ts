// LOCAL ONLY: stand up a real `basket` (A's program, loaded at genesis on the 8901 validator) over the
// local fixture mints, so the valuation API's program source and the redeem-payout check can run
// before A's program is on devnet. On devnet the basket is A's; this script refuses devnet.
//
//   node scripts/basket/program-basket.ts --cluster local --idl <A's basket.json> [--usd-per-leg 50]

import { join } from "node:path";
import { Keypair, SystemProgram, TransactionInstruction } from "../../services/valuation/src/lib/web3.ts";
import { loadIdl } from "../../services/valuation/src/lib/idl.ts";
import { basketPda, ixInitializeBasket, ixDeposit } from "../../services/valuation/src/lib/basket-client.ts";
import { ixCreateAtaIdempotent, ixMintToChecked, ata } from "../../services/valuation/src/lib/amm.ts";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, loadRegistry, loadKeypair, ISSUER_KEY, REPO, rpcFor, writeJson, nowIso } from "../lib/env.ts";
import { send, connection } from "../lib/tx.ts";

const c = cluster();
if (c !== "local") throw new Error("program-basket.ts is local only; the devnet basket belongs to Agent A");
const idlPath = arg("idl");
if (!idlPath) throw new Error("--idl <path to A's basket.json>");
const idl = loadIdl(idlPath);
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const usdPerLeg = Number(arg("usd-per-leg", "50"));

async function run() {
  const conn = connection(c);
  const shareMint = Keypair.generate();
  const basket = basketPda(idl.address, shareMint.publicKey.toBase58());
  const lamports = await conn.getMinimumBalanceForRentExemption(82);
  const initMint = new TransactionInstruction({ // InitializeMint2: decimals 9, authority = basket PDA, no freeze
    programId: new (await import("../../services/valuation/src/lib/web3.ts")).PublicKey(TOKEN_PROGRAM),
    data: Buffer.concat([Buffer.from([20, 9]), basket.toBuffer(), Buffer.from([0])]),
    keys: [{ pubkey: shareMint.publicKey, isSigner: false, isWritable: true }],
  });
  const sigs = [];
  sigs.push(await send(c, "create share mint (authority = basket PDA)", [SystemProgram.createAccount({ fromPubkey: issuer.publicKey, newAccountPubkey: shareMint.publicKey, lamports, space: 82, programId: initMint.programId }), initMint], [issuer, shareMint]));
  const legs = reg.legs.map((l: any) => ({ mint: l.mint, mirror_of: l.mirror_of }));
  sigs.push(await send(c, "initialize_basket", [ixInitializeBasket(idl, { payer: issuer.publicKey.toBase58(), authority: issuer.publicKey.toBase58(), shareMint: shareMint.publicKey.toBase58(), usdcMint: reg.usdc.mint, legs, maxConvertChunk: 10n ** 12n, routers: [reg.fixture_amm.program_id] })], [issuer], 1_400_000));

  // Bootstrap: equal USD per leg at the fixture pool price; mint the legs to the issuer, then deposit.
  const gross: bigint[] = [];
  const fund = [ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, shareMint.publicKey, TOKEN_PROGRAM).ix];
  for (const leg of reg.legs) {
    const p = reg.fixture_amm.pools.find((x: any) => x.index === leg.index);
    const r = await rpc.accounts([p.leg_vault, p.usdc_vault]);
    const usdPerRaw = Number(r.values[1].data.parsed.info.tokenAmount.amount) / 1e6 / Number(r.values[0].data.parsed.info.tokenAmount.amount);
    const g = BigInt(Math.floor(usdPerLeg / usdPerRaw));
    gross.push(g);
    fund.push(ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, leg.mint, TOKEN_2022_PROGRAM).ix, ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, ata(issuer.publicKey, leg.mint, TOKEN_2022_PROGRAM), issuer.publicKey, g * 3n, leg.decimals));
  }
  for (let i = 0; i < fund.length; i += 8) sigs.push(await send(c, "fund issuer legs for bootstrap and later deposits", fund.slice(i, i + 8), [issuer]));
  sigs.push(await send(c, "bootstrap", [ixDeposit(idl, "bootstrap", { depositor: issuer.publicKey.toBase58(), shareMint: shareMint.publicKey.toBase58(), legs, gross })], [issuer], 1_400_000));

  const out = { kind: "program-basket (local)", program: idl.address, share_mint: shareMint.publicKey.toBase58(), basket: basket.toBase58(), holder: issuer.publicKey.toBase58(), bootstrap_gross: gross.map(String), at: nowIso(), signatures: sigs };
  writeJson(join(REPO, "fixtures", ".local", "program-basket.json"), out);
  console.log(JSON.stringify({ program: out.program, share_mint: out.share_mint, basket: out.basket }, null, 1));
}

run().catch((e) => {
  console.error(e?.logs ?? e);
  console.error(e);
  process.exit(1);
});
