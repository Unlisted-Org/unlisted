// Stand-in basket: lets the valuation API run against real chain state before A's `basket` program is
// on the cluster. It is NOT the program and every API response says so (`basket_source: "standin"`).
//
//   node scripts/fixtures/standin-basket.ts --cluster local|devnet [--usd-per-leg 50]
//
// - share mint: classic SPL, 9 decimals, INITIAL_SHARES = 1_000_000_000 minted to the fixture issuer;
// - vaults: the stand-in vaults (scripts/scenarios/issuer.ts standin-vaults), topped up by mint_to to an
//   equal USD value per leg at Jupiter price v3 (the spec 01 bootstrap rule), prices recorded;
// - state file: A_i = balance after funding, C_i = 0, P_i = 0, L_i = 10^18 (what the program would
//   store after bootstrap). Scenario actions change balances on chain; the file keeps A_i, so the API
//   sees a seizure as a shortfall exactly as `observe` would.

import { join } from "node:path";
import { PublicKey } from "../../services/valuation/src/lib/web3.ts";
import { ixCreateAtaIdempotent, ixMintToChecked } from "../../services/valuation/src/lib/amm.ts";
import { ixBurnChecked } from "../lib/issuer.ts";
import { jupiterLastTrade } from "../../services/valuation/src/lib/sources.ts";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, arg, loadRegistry, writeJson, loadKeypair, ISSUER_KEY, REPO, rpcFor, nowIso } from "../lib/env.ts";
import { send } from "../lib/tx.ts";
import { splToken, signatureOf, confirmTx } from "../lib/cli.ts";

const c = cluster();
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const usdPerLeg = Number(arg("usd-per-leg", "50"));
const out = c === "devnet" ? join(REPO, "fixtures", "standin-basket.json") : join(REPO, "fixtures", ".local", "standin-basket.json");

async function run() {
  if (!reg.standin_vaults) throw new Error("run scripts/scenarios/issuer.ts standin-vaults first");
  const sigs: any[] = [];
  const created = splToken(c, ["create-token", "--decimals", "9", "--mint-authority", issuer.publicKey.toBase58(), "--program-id", TOKEN_PROGRAM]);
  const shareMint = created.commandOutput.address;
  sigs.push(await confirmTx(c, "create share mint (classic SPL, 9 decimals)", signatureOf(created)));
  const holder = ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, shareMint, TOKEN_PROGRAM);
  sigs.push(await send(c, "mint INITIAL_SHARES to the issuer", [holder.ix, ixMintToChecked(TOKEN_PROGRAM, shareMint, holder.address, issuer.publicKey, 1_000_000_000n, 9)], [issuer]));

  const prices = await jupiterLastTrade(reg.legs.map((l: any) => l.mirror_of));
  const legs: any[] = [];
  const topups = [];
  for (const leg of reg.legs) {
    const v = reg.standin_vaults.vaults.find((x: any) => x.mint === leg.mint);
    const p = prices[leg.mirror_of];
    const target = BigInt(Math.floor(usdPerLeg / p.usd_per_raw));
    const cur = BigInt((await rpc.account(v.vault)).value.data.parsed.info.tokenAmount.amount);
    if (cur < target) topups.push(ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, new PublicKey(v.vault), issuer.publicKey, target - cur, leg.decimals));
    // Setup only, before accounting starts: trim an over-funded vault to the target (delegate burn).
    if (cur > target) topups.push(ixBurnChecked(new PublicKey(v.vault), new PublicKey(leg.mint), issuer.publicKey, cur - target, leg.decimals));
    legs.push({ index: leg.index, symbol: leg.symbol, mint: leg.mint, mirror_of: leg.mirror_of, vault: v.vault, target_raw: target.toString(), price: { usd_per_raw: p.usd_per_raw, usdPricePrescaled: p.usd_per_unscaled_token, blockId: p.block, fetched_at: p.fetched_at, source: p.source } });
  }
  for (let i = 0; i < topups.length; i += 4) sigs.push(await send(c, "set stand-in vaults to equal USD value (mint_to / setup trim)", topups.slice(i, i + 4), [issuer]));

  const bal = await rpc.accounts(legs.map((l) => l.vault));
  legs.forEach((l, i) => {
    l.accounted = bal.values[i].data.parsed.info.tokenAmount.amount;
    l.claim_units = "0";
    l.pending_norm = "0";
    l.loss_index = (10n ** 18n).toString();
    l.status = "Active";
  });
  writeJson(out, {
    kind: "standin-basket",
    note: "Not the basket program. Real vaults and share mint on chain; A/C/P/L held here as the program would store them after bootstrap.",
    cluster: c,
    basket: reg.standin_vaults.owner,
    share_mint: shareMint,
    share_holder: issuer.publicKey.toBase58(),
    initial_shares: "1000000000",
    bootstrap: { usd_per_leg: usdPerLeg, weights: "equal by value", accounted_at_slot: bal.slot, at: nowIso() },
    legs,
    signatures: sigs,
  });
  console.log(`stand-in basket: share mint ${shareMint}; state ${out} (slot ${bal.slot})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
