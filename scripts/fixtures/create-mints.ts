// Create the seven fixture mints and fixture USDC, mirroring each mainnet PreStocks mint's CURRENT state.
//
//   node scripts/fixtures/create-mints.ts --cluster local|devnet [--force]
//
// For each constituent it reads the mainnet mint live, then:
//  1. create-token with the full PreStocks extension set, at the fee that is in force on mainnet NOW;
//  2. initialize-metadata (name suffixed "(devnet fixture)"; symbol and uri as mainnet);
//  3. if mainnet has a pending fee (newerTransferFee.epoch > current epoch), set-transfer-fee to it:
//     the fixture gets the same older->newer shape, two devnet epochs out;
//  4. if mainnet's newMultiplier differs from its stored multiplier, update-ui-amount-multiplier:
//       - mainnet timestamp already passed -> set with a timestamp ~45 s ahead, then wait for it, so the
//         fixture ends up exactly like mainnet: stored field unchanged, effective = newMultiplier;
//       - mainnet timestamp in the future -> set with the same timestamp.
// All authorities go to the fixture-issuer key (devnet stand-in for the 2-of-7 Squads multisig).
// Writes fixtures/registry.json (devnet) or fixtures/.local/registry.json (local) after every leg.

import { existsSync } from "node:fs";
import { CONSTITUENTS } from "../../services/valuation/src/lib/prestocks.ts";
import { extensions, feeSchedule, effectiveMultiplier, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, MAINNET_USDC } from "../../services/valuation/src/lib/token2022.ts";
import { cluster, flag, loadKeypair, ISSUER_KEY, mainnet, registryPath, readJson, rpcFor, writeJson, sleep, nowIso } from "../lib/env.ts";
import { runStep, splToken, signatureOf, confirmTx } from "../lib/cli.ts";

const U64_MAX_UI_9 = "18446744073.709551615"; // u64::MAX raw at 9 decimals: PreStocks maximumFee

const c = cluster();
const issuer = loadKeypair(ISSUER_KEY).publicKey.toBase58();
const rpc = rpcFor(c);
const main = mainnet();
const path = registryPath(c);

const reg: any = existsSync(path) && !flag("force")
  ? readJson(path)
  : { schema: 1, cluster: c, fixture_issuer: issuer, token_2022_program: TOKEN_2022_PROGRAM, legs: [], usdc: null, fixture_amm: null, hook_program: null };
if (reg.fixture_issuer !== issuer) throw new Error(`registry issuer ${reg.fixture_issuer} != key ${issuer}`);

const save = () => writeJson(path, reg);

async function main_() {
  const [mEpoch, snap] = await Promise.all([main.epochInfo(), main.accounts(CONSTITUENTS.map((x) => x.mainnet_mint))]);
  const localEpoch = await rpc.epochInfo();
  console.log(`mainnet slot ${snap.slot} epoch ${mEpoch.epoch}; ${c} slot ${localEpoch.absoluteSlot} epoch ${localEpoch.epoch}`);
  reg.mirror_source = { cluster: "mainnet", slot: snap.slot, epoch: mEpoch.epoch, read_at: nowIso() };
  const nowUnix = Math.floor(Date.now() / 1000);
  const multiplierUpdates: { leg: any; value: string; ts: number }[] = [];

  for (const k of CONSTITUENTS) {
    if (reg.legs.find((l: any) => l.index === k.index && l.complete)) {
      console.log(`${k.symbol}: already created (${reg.legs.find((l: any) => l.index === k.index).mint})`);
      continue;
    }
    const acct = snap.values[k.index];
    if (!acct) throw new Error(`${k.symbol} mainnet mint missing`);
    const info = acct.data.parsed.info;
    const x = extensions(info);
    const fee = feeSchedule(info, mEpoch.epoch)!;
    const mult = effectiveMultiplier(info, nowUnix);
    const md = x.tokenMetadata;

    const leg: any = {
      index: k.index,
      symbol: k.symbol,
      mirror_of: k.mainnet_mint,
      decimals: info.decimals,
      token_program: TOKEN_2022_PROGRAM,
      mirrored_at_mainnet_slot: snap.slot,
      mirrored: { fee_now_bps: fee.now_bps, fee_pending: fee.pending, multiplier_stored: mult.stored, multiplier_new: mult.new_multiplier, multiplier_new_ts: mult.new_multiplier_effective_ts },
      signatures: [],
    };

    const created = splToken(c, [
      "create-token", "--program-2022", "--decimals", String(info.decimals),
      "--transfer-fee-basis-points", String(fee.now_bps), "--transfer-fee-maximum-fee", U64_MAX_UI_9,
      "--enable-permanent-delegate", "--enable-pause", "--enable-freeze",
      "--default-account-state", x.defaultAccountState.accountState,
      "--enable-transfer-hook", "--ui-amount-multiplier", mult.stored,
      "--enable-metadata", "--enable-confidential-transfers", x.confidentialTransferMint.autoApproveNewAccounts ? "auto" : "manual",
      "--mint-authority", issuer,
    ]);
    leg.mint = created.commandOutput.address;
    leg.signatures.push(await confirmTx(c, "create-token", signatureOf(created)));
    reg.legs = reg.legs.filter((l: any) => l.index !== k.index).concat([leg]).sort((a: any, b: any) => a.index - b.index);
    save();
    console.log(`${k.symbol}: mint ${leg.mint}`);

    leg.signatures.push(await runStep(c, "initialize-metadata", [
      "initialize-metadata", leg.mint, `${md.name} (devnet fixture)`, md.symbol, md.uri,
      "--mint-authority", ISSUER_KEY, "--update-authority", issuer,
    ]));

    if (fee.pending) {
      const maxUi = fee.pending.maximum_fee === "18446744073709551615" ? U64_MAX_UI_9 : (Number(fee.pending.maximum_fee) / 1e9).toString();
      leg.signatures.push(await runStep(c, `set-transfer-fee ${fee.now_bps}->${fee.pending.bps} bps (mirrors mainnet pending change, effective mainnet epoch ${fee.pending.effective_epoch})`, [
        "set-transfer-fee", leg.mint, String(fee.pending.bps), maxUi, "--transfer-fee-authority", ISSUER_KEY,
      ]));
    }

    if (Number(mult.new_multiplier) !== Number(mult.stored)) {
      const ts = mult.new_multiplier_effective_ts > nowUnix ? mult.new_multiplier_effective_ts : Math.floor(Date.now() / 1000) + 45;
      multiplierUpdates.push({ leg, value: mult.new_multiplier, ts });
    }
    leg.complete = multiplierUpdates.every((u) => u.leg !== leg);
    save();
  }

  for (const u of multiplierUpdates) {
    u.leg.signatures.push(await runStep(c, `update-ui-amount-multiplier ${u.value} at ${u.ts} (mainnet newMultiplier; stored field left as mainnet's)`, [
      "update-ui-amount-multiplier", u.leg.mint, u.value, String(u.ts), "--ui-multiplier-authority", ISSUER_KEY,
    ]));
    u.leg.complete = true;
    save();
  }
  if (multiplierUpdates.length) {
    const until = Math.max(...multiplierUpdates.map((u) => u.ts));
    while (Date.now() / 1000 < until + 2) await sleep(2000);
    console.log("multiplier timestamps passed");
  }

  if (!reg.usdc) {
    const created = splToken(c, ["create-token", "--decimals", "6", "--enable-freeze", "--mint-authority", issuer, "--program-id", TOKEN_PROGRAM]);
    reg.usdc = {
      mint: created.commandOutput.address,
      decimals: 6,
      token_program: TOKEN_PROGRAM,
      mirror_of: MAINNET_USDC,
      mint_authority: issuer,
      signatures: [await confirmTx(c, "create-token (fixture USDC, classic SPL)", signatureOf(created))],
    };
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
