// Issuer scenario suite (spec 02, Fixtures): the fixture issuer uses each PreStocks power against a
// target vault, with real signed transactions, and records every step.
//
//   node scripts/scenarios/issuer.ts <action> --cluster local|devnet --vault <token account> [options]
//   node scripts/scenarios/issuer.ts <pause|resume|fee|multiplier|hook-on|hook-off|default-state> --cluster devnet --symbol KALSHI
//
//   seize          --amount <raw> | --bps <n>     permanent-delegate BurnChecked from the vault
//   pause | resume                                PausableExtension on the vault's mint
//   fee            --bps <n> [--wait]             SetTransferFee (takes effect two epochs out)
//   multiplier     --value <x> --in-seconds <n> [--wait]   UpdateMultiplier with a near-future timestamp
//                  (or --at <unix ts>; --at 0 resets the stored field too)
//   hook-on | hook-off                            TransferHook program set to fixture_hook / cleared
//   freeze | thaw                                 FreezeAccount / ThawAccount on the vault itself
//   default-state  --state frozen|initialized     DefaultAccountState update (watcher event)
//   standin-vaults [--raw <n>]                    create (and optionally fund) a stand-in vault per leg
//
// Options: --actor <name> (recorded; default "ops"), --note <text>.
//
// Every run appends to fixtures/scenarios/<scenario>.json (devnet) or fixtures/.local/scenarios/ (local):
// before/after state read at stated slots, each signature with slot and block time, and an effect probe:
// a *simulated* 1,000,000-raw transfer from the issuer into the vault, which shows the rejection
// (MintPaused 0x43, AccountFrozen 0x11, hook accounts missing) or the fee withheld, without changing
// the vault's balance. Simulations have no signature; they are labelled as simulations.
//
// Until the basket program is on devnet, `standin-vaults` provides targets: for each leg, the ATA of an
// off-curve address derived from ["standin-vault"] under the fixture_amm program id. fixture_amm never
// signs for that seed, so, like a basket vault, only the issuer's powers can move its tokens.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PublicKey, Transaction, TransactionInstruction } from "../../services/valuation/src/lib/web3.ts";
import { issuerControls, effectiveMultiplier, feeSchedule, TOKEN_2022_PROGRAM, transferFee } from "../../services/valuation/src/lib/token2022.ts";
import { ata, ixCreateAtaIdempotent, ixMintToChecked, ixTransferChecked } from "../../services/valuation/src/lib/amm.ts";
import { cluster, arg, flag, loadRegistry, loadKeypair, ISSUER_KEY, KEY_DIR, rpcFor, scenarioDir, readJson, writeJson, nowIso, sleep } from "../lib/env.ts";
import { send, connection } from "../lib/tx.ts";
import { ixBurnChecked, ixSetTransferFee, ixUpdateMultiplier, ixPause, ixSetHook, ixSetDefaultState, ixFreeze, ixInitHookValidation } from "../lib/issuer.ts";

const action = process.argv[2];
const c = cluster();
const reg = loadRegistry(c);
const rpc = rpcFor(c);
const issuer = loadKeypair(ISSUER_KEY);
const actor = arg("actor", "ops")!;

const SCENARIO: Record<string, string> = {
  seize: "seizure", pause: "pause-resume", resume: "pause-resume", fee: "fee-change", multiplier: "multiplier-change",
  "hook-on": "hook-switched-on", "hook-off": "hook-switched-on", freeze: "frozen-vault", thaw: "frozen-vault",
  "default-state": "default-state-change", "standin-vaults": "standin-vaults",
};
const DESCRIPTION: Record<string, string> = {
  seizure: "Fixture issuer burns from a vault as permanent delegate (PreStocks did this to 29 holder accounts on 2025-09-19).",
  "pause-resume": "Fixture issuer pauses the vault's mint; every transfer of that mint fails with MintPaused (0x43) until resume.",
  "fee-change": "Fixture issuer changes the transfer fee (PreStocks: 100 -> 300 bps on 2026-09-24, effective epoch 1043). Takes effect two epochs out.",
  "multiplier-change": "Fixture issuer schedules a scaled-UI multiplier change a short time ahead. Raw amounts never change; display changes after the timestamp.",
  "hook-switched-on": "Fixture issuer attaches a transfer-hook program (fixture_hook) to the vault's mint, and later clears it.",
  "frozen-vault": "Fixture issuer freezes the vault token account itself (AccountFrozen 0x11 on any transfer in or out).",
  "default-state-change": "Fixture issuer changes the mint's default account state (new accounts start frozen).",
  standin: "Stand-in vaults used as scenario targets until the basket program's vaults exist.",
};

const pk = (s: string) => new PublicKey(s);
const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString().replace(".000Z", "Z") : null);
const standinOwner = () => PublicKey.findProgramAddressSync([Buffer.from("standin-vault")], pk(reg.fixture_amm.program_id))[0];

async function snapshot(vault: string, mint: string) {
  const [epoch, accs] = await Promise.all([rpc.epochInfo(), rpc.accounts([vault, mint])]);
  const now = Math.floor(Date.now() / 1000);
  const v = accs.values[0]?.data?.parsed?.info;
  const m = accs.values[1].data.parsed.info;
  return {
    slot: accs.slot,
    epoch: epoch.epoch,
    read_at: nowIso(),
    vault: v ? { owner: v.owner, amount_raw: v.tokenAmount.amount, state: v.state, withheld_raw: v.extensions?.find((e: any) => e.extension === "transferFeeAmount")?.state?.withheldAmount ?? null } : null,
    mint: issuerControls(m, epoch.epoch, now),
  };
}

/** Simulate a 1,000,000-raw transfer from the issuer into the vault and return the outcome. */
async function probe(vault: string, mint: string, decimals: number) {
  const conn = connection(c);
  const src = ata(issuer.publicKey, mint, TOKEN_2022_PROGRAM);
  const amount = 1_000_000n;
  const tx = new Transaction().add(ixTransferChecked(TOKEN_2022_PROGRAM, src, mint, pk(vault), issuer.publicKey, amount, decimals));
  tx.feePayer = issuer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(issuer);
  const r = await rpc.call("simulateTransaction", [tx.serialize().toString("base64"), {
    encoding: "base64", commitment: "confirmed", sigVerify: true, accounts: { addresses: [vault], encoding: "jsonParsed" },
  }]);
  const post = r.value.accounts?.[0]?.data?.parsed?.info;
  const withheld = post?.extensions?.find((e: any) => e.extension === "transferFeeAmount")?.state?.withheldAmount;
  const errLine = (r.value.logs ?? []).find((l: string) => /failed|Error|error/.test(l)) ?? null;
  return {
    kind: "simulation (no signature)",
    what: `transfer_checked ${amount} raw issuer -> vault`,
    slot: r.context.slot,
    err: r.value.err,
    error_log: errLine,
    vault_amount_after_raw: post?.tokenAmount?.amount ?? null,
    vault_withheld_after_raw: withheld ?? null,
  };
}

/** Simulate Token-2022 AmountToUiAmount(10^9 raw): the chain's own display conversion (effective multiplier). */
async function chainUiAmount(mint: string) {
  const conn = connection(c);
  const ix = new TransactionInstruction({ programId: pk(TOKEN_2022_PROGRAM), data: Buffer.concat([Buffer.from([23]), Buffer.from(new BigUint64Array([1_000_000_000n]).buffer)]), keys: [{ pubkey: pk(mint), isSigner: false, isWritable: false }] });
  const tx = new Transaction().add(ix);
  tx.feePayer = issuer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(issuer);
  const r = await rpc.call("simulateTransaction", [tx.serialize().toString("base64"), { encoding: "base64", commitment: "confirmed" }]);
  const rd = r.value.returnData?.data?.[0];
  return { kind: "simulation (no signature)", what: "AmountToUiAmount(1000000000 raw)", slot: r.context.slot, ui_amount: rd ? Buffer.from(rd, "base64").toString("utf8") : null, err: r.value.err };
}

function record(scenario: string, run: any) {
  const path = join(scenarioDir(c), `${scenario}.json`);
  const file = existsSync(path) ? readJson(path) : { scenario, cluster: c, description: DESCRIPTION[scenario] ?? "", fixture_issuer: issuer.publicKey.toBase58(), runs: [] };
  file.runs.push(run);
  writeJson(path, file);
  console.log(`recorded ${scenario} run ${file.runs.length} -> ${path}`);
}

async function ensureIssuerHolds(mint: string, decimals: number) {
  const a = ata(issuer.publicKey, mint, TOKEN_2022_PROGRAM);
  const bal = (await rpc.account(a.toBase58())).value?.data?.parsed?.info?.tokenAmount?.amount;
  if (bal && BigInt(bal) >= 10_000_000n) return;
  const m = (await rpc.account(mint)).value.data.parsed.info;
  if (m.extensions?.find((e: any) => e.extension === "pausableConfig")?.state?.paused) return; // can't mint while paused
  await send(c, "fund issuer for probes", [ixCreateAtaIdempotent(issuer.publicKey, issuer.publicKey, mint, TOKEN_2022_PROGRAM).ix, ixMintToChecked(TOKEN_2022_PROGRAM, mint, a, issuer.publicKey, 100_000_000n, decimals)], [issuer]);
}

async function standinVaults() {
  const owner = standinOwner();
  const raw = BigInt(arg("raw", "0")!); // 0: create only; scripts/fixtures/standin-basket.ts funds them
  const out: any[] = [];
  for (const leg of reg.legs) {
    const v = ixCreateAtaIdempotent(issuer.publicKey, owner, leg.mint, TOKEN_2022_PROGRAM);
    const tx = await send(c, `create stand-in vault ${leg.symbol}${raw ? ` + fund ${raw} raw` : ""}`, raw ? [v.ix, ixMintToChecked(TOKEN_2022_PROGRAM, leg.mint, v.address, issuer.publicKey, raw, leg.decimals)] : [v.ix], [issuer]);
    out.push({ index: leg.index, symbol: leg.symbol, mint: leg.mint, vault: v.address.toBase58(), tx });
    console.log(`${leg.symbol}: stand-in vault ${v.address.toBase58()}`);
  }
  reg.standin_vaults = { owner: owner.toBase58(), derivation: `PDA(["standin-vault"], fixture_amm ${reg.fixture_amm.program_id})`, vaults: out.map(({ tx, ...x }) => x) };
  writeJson((await import("../lib/env.ts")).registryPath(c), reg);
  record("standin-vaults", { actor, at: nowIso(), owner: owner.toBase58(), vaults: out });
}

async function run() {
  if (!SCENARIO[action]) throw new Error(`unknown action ${action}; see the header of this file`);
  if (action === "standin-vaults") return standinVaults();

  // Target: --vault <token account> (any action), or --mint <mint> / --symbol <SYM> for mint-level actions
  // (pause, resume, fee, multiplier, hook-on/off, default-state). With a mint only, the leg's stand-in
  // vault (if any) is used just for the before/after probes; the record says so.
  const MINT_LEVEL = new Set(["pause", "resume", "fee", "multiplier", "hook-on", "hook-off", "default-state"]);
  let vault = arg("vault");
  let mintOnly = false;
  if (!vault) {
    if (!MINT_LEVEL.has(action)) throw new Error(`${action} needs --vault <token account>`);
    const sym = arg("symbol");
    const m = arg("mint") ?? reg.legs.find((l: any) => l.symbol === sym)?.mint;
    if (!m) throw new Error("give --vault <token account>, or --mint <fixture mint> / --symbol <SYMBOL> for a mint-level action");
    vault = reg.standin_vaults?.vaults?.find((v: any) => v.mint === m)?.vault;
    if (!vault) throw new Error(`no stand-in vault for ${m} to probe; pass --vault`);
    mintOnly = true;
  }
  const va = (await rpc.account(vault)).value;
  if (!va) throw new Error(`vault ${vault} not found on ${c}`);
  const mint: string = va.data.parsed.info.mint;
  const leg = reg.legs.find((l: any) => l.mint === mint);
  if (!leg) throw new Error(`vault's mint ${mint} is not a registered fixture leg`);
  const decimals: number = leg.decimals;
  const M = pk(mint), V = pk(vault), I = issuer.publicKey;

  await ensureIssuerHolds(mint, decimals);
  const before = await snapshot(vault, mint);
  const steps: any[] = [];
  const probes: any[] = [];
  const extra: any = {};
  probes.push({ when: "before", ...(await probe(vault, mint, decimals)) });

  switch (action) {
    case "seize": {
      const bal = BigInt(before.vault!.amount_raw);
      const amount = arg("amount") ? BigInt(arg("amount")!) : (bal * BigInt(arg("bps", "1000")!)) / 10_000n;
      if (amount <= 0n || amount > bal) throw new Error(`bad seizure amount ${amount} (vault holds ${bal})`);
      steps.push(await send(c, `permanent-delegate BurnChecked ${amount} raw from vault`, [ixBurnChecked(V, M, I, amount, decimals)], [issuer]));
      extra.seized_raw = amount.toString();
      break;
    }
    case "pause":
    case "resume":
      steps.push(await send(c, action, [ixPause(M, I, action === "pause")], [issuer]));
      break;
    case "fee": {
      const bps = Number(arg("bps", "300"));
      steps.push(await send(c, `SetTransferFee -> ${bps} bps, maximumFee u64::MAX`, [ixSetTransferFee(M, I, bps, 2n ** 64n - 1n)], [issuer]));
      break;
    }
    case "multiplier": {
      const value = Number(arg("value"));
      const inSec = Number(arg("in-seconds", "120"));
      if (!(value > 0)) throw new Error("--value <multiplier> required");
      // --at <unix ts> sets the timestamp explicitly (0 = in the past: stored and new both become value).
      const ts = arg("at") !== undefined ? Number(arg("at")) : Math.floor(Date.now() / 1000) + inSec;
      extra.effective_ts = ts;
      extra.effective_at = iso(ts);
      extra.chain_ui_amount_before = await chainUiAmount(mint);
      steps.push(await send(c, `UpdateMultiplier ${value} effective ${iso(ts)}`, [ixUpdateMultiplier(M, I, value, ts)], [issuer]));
      extra.chain_ui_amount_after_tx = await chainUiAmount(mint);
      break;
    }
    case "hook-on": {
      const hook = pk(reg.hook_program?.program_id ?? loadKeypair(join(KEY_DIR, "fixture-hook-program.json")).publicKey.toBase58());
      const init = ixInitHookValidation(hook, M, I);
      const exists = (await rpc.account(init.validation.toBase58())).value;
      steps.push(await send(c, `set transfer hook -> fixture_hook ${hook.toBase58()}${exists ? "" : " + init validation account"}`, exists ? [ixSetHook(M, I, hook)] : [ixSetHook(M, I, hook), init.ix], [issuer]));
      extra.hook_program = hook.toBase58();
      extra.validation_account = init.validation.toBase58();
      break;
    }
    case "hook-off":
      steps.push(await send(c, "clear transfer hook (program id None)", [ixSetHook(M, I, null)], [issuer]));
      break;
    case "freeze":
    case "thaw":
      steps.push(await send(c, `${action === "freeze" ? "FreezeAccount" : "ThawAccount"} on the vault`, [ixFreeze(V, M, I, action === "freeze")], [issuer]));
      break;
    case "default-state": {
      const frozen = arg("state", "frozen") === "frozen";
      steps.push(await send(c, `DefaultAccountState -> ${frozen ? "frozen" : "initialized"}`, [ixSetDefaultState(M, I, frozen)], [issuer]));
      break;
    }
  }

  const after = await snapshot(vault, mint);
  probes.push({ when: "after", ...(await probe(vault, mint, decimals)) });

  // Waits that complete a scenario (fee activation, multiplier timestamp).
  if (action === "fee" && flag("wait")) {
    const target = after.mint.fee!.newer.epoch;
    console.log(`waiting for epoch ${target} (now ${after.epoch})`);
    while ((await rpc.epochInfo()).epoch < target) await sleep(15_000);
    extra.after_activation = await snapshot(vault, mint);
    probes.push({ when: "after activation", ...(await probe(vault, mint, decimals)), expected_withheld_raw: transferFee(1_000_000n, after.mint.fee!.newer.bps).toString() });
  }
  if (action === "multiplier" && flag("wait")) {
    while (Date.now() / 1000 < extra.effective_ts + 2) await sleep(2000);
    const s = await snapshot(vault, mint);
    extra.after_effective = { slot: s.slot, read_at: s.read_at, multiplier: s.mint.multiplier, vault_amount_raw: s.vault?.amount_raw };
    extra.chain_ui_amount_after_effective = await chainUiAmount(mint);
  }

  const scenario = SCENARIO[action];
  const failedTx = steps.find((s) => s.err);
  record(scenario, {
    action, actor, note: arg("note") ?? null, at: nowIso(),
    target: mintOnly ? { mint, symbol: leg.symbol, mirror_of: leg.mirror_of, vault: null, probe_vault: vault, note: "mint-level action; probes use the leg's stand-in vault" } : { vault, vault_owner: before.vault?.owner, mint, symbol: leg.symbol, mirror_of: leg.mirror_of, standin: before.vault?.owner === standinOwner().toBase58() },
    steps, before, after, probes, ...extra, ok: !failedTx,
  });
  console.log(JSON.stringify({ action, steps: steps.map((s) => `${s.step}: ${s.signature} @${s.slot}`), probe_before: probes[0].err ?? "ok", probe_after: probes[1].err ?? "ok" }, null, 1));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
