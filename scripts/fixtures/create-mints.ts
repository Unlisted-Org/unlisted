// Create the seven fixture mints and fixture USDC, mirroring each mainnet PreStocks mint's CURRENT state.
//
//   node scripts/fixtures/create-mints.ts --cluster local|devnet [--force]
//
// For each constituent it reads the mainnet mint live, then:
//  1. create-token with the full PreStocks extension set, at the fee that is in force on mainnet NOW;
//  2. initialize-metadata (name suffixed "(devnet fixture)"; symbol and uri as mainnet);
//  3. if mainnet has a pending fee (newerTransferFee.epoch > current epoch), SetTransferFee (raw) to it:
//     the fixture gets the same older->newer shape, two devnet epochs out;
//  4. if mainnet's newMultiplier differs from its stored multiplier, UpdateMultiplier (raw):
//       - mainnet timestamp already passed -> set with a timestamp ~45 s ahead, then wait for it, so the
//         fixture ends up exactly like mainnet: stored field unchanged, effective = newMultiplier;
//       - mainnet timestamp in the future -> set with the same timestamp.
// All authorities go to the fixture-issuer key (devnet stand-in for the 2-of-7 Squads multisig).
// Writes fixtures/registry.json (devnet) or fixtures/.local/registry.json (local) after every leg.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONSTITUENTS } from "../../services/valuation/src/lib/prestocks.ts";
import { extensions, feeSchedule, effectiveMultiplier, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, MAINNET_USDC } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, flag, loadKeypair, ISSUER_KEY, KEY_DIR, mainnet, registryPath, readJson, rpcFor, writeJson, sleep, nowIso } from "../lib/env.ts";
import { runStep, splToken, signatureOf, confirmTx } from "../lib/cli.ts";
import { send } from "../lib/tx.ts";
import { ixSetTransferFee, ixUpdateMultiplier } from "../lib/issuer.ts";
import { PublicKey, Keypair } from "../../services/valuation/src/lib/web3.ts";

const U64_MAX_UI_9 = "18446744073.709551615"; // u64::MAX raw at 9 decimals: PreStocks maximumFee (create-token only takes UI)

const c = cluster();
const issuerKp = loadKeypair(ISSUER_KEY);
const issuer = issuerKp.publicKey.toBase58();
const rpc = rpcFor(c);
const main = mainnet();
const path = registryPath(c);

const reg: any = existsSync(path) && !flag("force")
  ? readJson(path)
  : { schema: 1, cluster: c, fixture_issuer: issuer, token_2022_program: TOKEN_2022_PROGRAM, legs: [], usdc: null, fixture_amm: null, hook_program: null };
if (reg.fixture_issuer !== issuer) throw new Error(`registry issuer ${reg.fixture_issuer} != key ${issuer}`);
// Where the fixture-issuer key lives (outside the repo) and who may use it (spec owner, 2026-09-25).
reg.fixture_issuer_keypair_path = "~/.config/solana/stocklana/fixture-issuer.json";
reg.fixture_issuer_policy = {
  owner: "Agent C (ops)",
  agent_b_may: ["pause/resume a fixture leg", "fund test wallets with fixture USDC and fixture legs"],
  everything_else: "issuer scenarios are run by Agent C or Agent A only",
  scripts: {
    pause: "node scripts/scenarios/issuer.ts pause --cluster devnet --symbol <SYMBOL>",
    resume: "node scripts/scenarios/issuer.ts resume --cluster devnet --symbol <SYMBOL>",
    fund_wallet: "node scripts/fixtures/fund-wallet.ts --cluster devnet --wallet <pubkey> [--usdc 200] [--leg-usd 20] [--sol 0.02]",
    setup: "npm install in services/valuation (the scripts import @solana/web3.js from there)",
  },
};

const save = () => writeJson(path, reg);

/** Mint keypairs are persisted (outside the repo) so a retried create-token can't orphan a mint. */
function mintKeypair(symbol: string) {
  const dir = join(KEY_DIR, "fixture-mints");
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${c}-${symbol}.json`);
  if (!existsSync(p)) writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  return { path: p, pubkey: loadKeypair(p).publicKey.toBase58() };
}

/** create-token with a fixed mint keypair. Returns null if the mint already existed (a retry after landing). */
function createToken(kpPath: string, args: string[]) {
  try {
    return splToken(c, [...args, kpPath]);
  } catch (e: any) {
    if (/already in use/i.test(String(e?.output ?? e))) return null;
    throw e;
  }
}

async function readMint(mint: string) {
  for (let i = 0; i < 10; i++) {
    const v = (await rpc.account(mint)).value;
    if (v) return v.data.parsed.info;
    await sleep(2000);
  }
  throw new Error(`mint ${mint} not readable`);
}

async function main_() {
  const [mEpoch, snap] = await Promise.all([main.epochInfo(), main.accounts(CONSTITUENTS.map((x) => x.mainnet_mint))]);
  const localEpoch = await rpc.epochInfo();
  console.log(`mainnet slot ${snap.slot} epoch ${mEpoch.epoch}; ${c} slot ${localEpoch.absoluteSlot} epoch ${localEpoch.epoch}`);
  reg.mirror_source = { cluster: "mainnet", slot: snap.slot, epoch: mEpoch.epoch, read_at: nowIso() };
  const nowUnix = Math.floor(Date.now() / 1000);
  const multiplierUpdates: { leg: any; value: string; ts: number }[] = [];

  const fixtureEpoch = localEpoch.epoch;
  for (const k of CONSTITUENTS) {
    let leg: any = reg.legs.find((l: any) => l.index === k.index);
    if (leg?.complete) {
      console.log(`${k.symbol}: already created (${leg.mint})`);
      continue;
    }
    const acct = snap.values[k.index];
    if (!acct) throw new Error(`${k.symbol} mainnet mint missing`);
    const info = acct.data.parsed.info;
    const x = extensions(info);
    const fee = feeSchedule(info, mEpoch.epoch)!;
    const mult = effectiveMultiplier(info, nowUnix);
    const md = x.tokenMetadata;

    if (!leg) {
      leg = {
        index: k.index,
        symbol: k.symbol,
        mirror_of: k.mainnet_mint,
        decimals: info.decimals,
        token_program: TOKEN_2022_PROGRAM,
        mirrored_at_mainnet_slot: snap.slot,
        mirrored: { fee_now_bps: fee.now_bps, fee_pending: fee.pending, multiplier_stored: mult.stored, multiplier_new: mult.new_multiplier, multiplier_new_ts: mult.new_multiplier_effective_ts },
        signatures: [],
      };
      reg.legs = reg.legs.concat([leg]).sort((a: any, b: any) => a.index - b.index);
    }

    // Every step checks chain state first, so a run interrupted by RPC limits resumes without orphans.
    if (!leg.mint) {
      const kp = mintKeypair(k.symbol);
      if (!(await rpc.account(kp.pubkey)).value) {
        const created = createToken(kp.path, [
          "create-token", "--program-2022", "--decimals", String(info.decimals),
          "--transfer-fee-basis-points", String(fee.now_bps), "--transfer-fee-maximum-fee", U64_MAX_UI_9,
          "--enable-permanent-delegate", "--enable-pause", "--enable-freeze",
          "--default-account-state", x.defaultAccountState.accountState,
          "--enable-transfer-hook", "--ui-amount-multiplier", mult.stored,
          "--enable-metadata", "--enable-confidential-transfers", x.confidentialTransferMint.autoApproveNewAccounts ? "auto" : "manual",
          "--mint-authority", issuer,
        ]);
        if (created) leg.signatures.push(await confirmTx(c, "create-token", signatureOf(created)));
      }
      leg.mint = kp.pubkey;
      save();
    }
    console.log(`${k.symbol}: mint ${leg.mint}`);
    let on = await readMint(leg.mint);

    if (!extensions(on).tokenMetadata) {
      leg.signatures.push(await runStep(c, "initialize-metadata", [
        "initialize-metadata", leg.mint, `${md.name} (devnet fixture)`, md.symbol, md.uri,
        "--mint-authority", ISSUER_KEY, "--update-authority", issuer,
      ]));
      save();
    }

    on = await readMint(leg.mint);
    const onFee = feeSchedule(on, fixtureEpoch)!;
    if (fee.pending && !(onFee.newer.bps === fee.pending.bps && onFee.newer.epoch > onFee.older.epoch)) {
      leg.signatures.push(await send(c, `SetTransferFee ${fee.now_bps}->${fee.pending.bps} bps, maximumFee ${fee.pending.maximum_fee} (mirrors mainnet pending change, effective mainnet epoch ${fee.pending.effective_epoch})`,
        [ixSetTransferFee(new PublicKey(leg.mint), issuerKp.publicKey, fee.pending.bps, BigInt(fee.pending.maximum_fee))], [issuerKp]));
      save();
    }

    const onMult = extensions(on).scaledUiAmountConfig;
    if (Number(mult.new_multiplier) !== Number(mult.stored) && Number(onMult?.newMultiplier) !== Number(mult.new_multiplier)) {
      const ts = mult.new_multiplier_effective_ts > nowUnix ? mult.new_multiplier_effective_ts : Math.floor(Date.now() / 1000) + 120;
      multiplierUpdates.push({ leg, value: mult.new_multiplier, ts });
    }
    leg.complete = multiplierUpdates.every((u) => u.leg !== leg);
    save();
  }

  for (const u of multiplierUpdates) {
    u.leg.signatures.push(await send(c, `UpdateMultiplier ${u.value} at ${u.ts} (mainnet newMultiplier; stored field left as mainnet's)`,
      [ixUpdateMultiplier(new PublicKey(u.leg.mint), issuerKp.publicKey, Number(u.value), u.ts)], [issuerKp]));
    u.leg.complete = true;
    save();
  }
  if (multiplierUpdates.length) {
    const until = Math.max(...multiplierUpdates.map((u) => u.ts));
    while (Date.now() / 1000 < until + 2) await sleep(2000);
    console.log("multiplier timestamps passed");
  }

  // Repair: if an UpdateMultiplier landed after its own timestamp (e.g. delayed by RPC limits), Token-2022
  // also overwrote the stored field. Put it back the way mainnet has it: set the stored value with a past
  // timestamp, then the new value with a timestamp far enough ahead, and wait for it.
  for (const k of CONSTITUENTS) {
    const leg = reg.legs.find((l: any) => l.index === k.index);
    const mi = snap.values[k.index].data.parsed.info;
    const want = effectiveMultiplier(mi, Math.floor(Date.now() / 1000));
    const have = extensions(await readMint(leg.mint)).scaledUiAmountConfig;
    if (Number(have.multiplier) === Number(want.stored) && Number(have.newMultiplier) === Number(want.new_multiplier)) continue;
    console.log(`${k.symbol}: repairing multiplier (stored ${have.multiplier}, new ${have.newMultiplier}; mainnet ${want.stored} / ${want.new_multiplier})`);
    leg.signatures.push(await send(c, `repair: UpdateMultiplier ${want.stored} at 0 (restore stored field)`, [ixUpdateMultiplier(new PublicKey(leg.mint), issuerKp.publicKey, Number(want.stored), 0)], [issuerKp]));
    if (Number(want.new_multiplier) !== Number(want.stored)) {
      const ts = Math.floor(Date.now() / 1000) + 180;
      leg.signatures.push(await send(c, `repair: UpdateMultiplier ${want.new_multiplier} at ${ts} (stored field left as mainnet's)`, [ixUpdateMultiplier(new PublicKey(leg.mint), issuerKp.publicKey, Number(want.new_multiplier), ts)], [issuerKp]));
      const after = extensions(await readMint(leg.mint)).scaledUiAmountConfig;
      if (Number(after.multiplier) !== Number(want.stored)) throw new Error(`${k.symbol}: update landed after its timestamp again; rerun`);
      while (Date.now() / 1000 < ts + 2) await sleep(2000);
    }
    save();
  }

  if (!reg.usdc) {
    const kp = mintKeypair("USDC");
    const sigs = [];
    if (!(await rpc.account(kp.pubkey)).value) {
      const created = createToken(kp.path, ["create-token", "--decimals", "6", "--enable-freeze", "--mint-authority", issuer, "--program-id", TOKEN_PROGRAM]);
      if (created) sigs.push(await confirmTx(c, "create-token (fixture USDC, classic SPL)", signatureOf(created)));
    }
    reg.usdc = { mint: kp.pubkey, decimals: 6, token_program: TOKEN_PROGRAM, mirror_of: MAINNET_USDC, mint_authority: issuer, signatures: sigs };
    save();
    console.log(`USDC: ${reg.usdc.mint}`);
  }

  const done = await rpc.slot();
  reg.created_at_slot = done;
  reg.updated_at = nowIso();
  save();
  console.log(`registry written: ${path} (slot ${done})`);
}

main_().catch((e) => {
  console.error(e);
  process.exit(1);
});
