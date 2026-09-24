// Devnet config for the app and the e2e, from the other agents' published addresses (read only):
//   npx tsx e2e/devnet/make-env.ts --share-mint <basket share mint> [--program <id>] [--valuation-url <url>]
//       [--registry <path> | --registry-ref ops]  (default: `git show ops:fixtures/registry.json`)
// Writes e2e/devnet/env.json (gitignored keys stay outside the repo) and public/config.json.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import * as sdk from "@unlisted/sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "../..");
const REPO = "/Users/jagadeesh/1nonly/grants/stocklana";
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";

async function main() {
  const shareMint = arg("share-mint");
  if (!shareMint) throw new Error("--share-mint required (from Agent A's devnet deployment record)");
  const reg = arg("registry")
    ? JSON.parse(readFileSync(arg("registry")!, "utf8"))
    : JSON.parse(execSync(`git -C ${REPO} show ${arg("registry-ref") ?? "ops"}:fixtures/registry.json`, { encoding: "utf8" }));
  if (reg.cluster !== "devnet") throw new Error(`registry cluster is ${reg.cluster}, not devnet`);
  const idl = JSON.parse(execSync(`git -C ${REPO} show program:programs/basket/idl/basket.json`, { encoding: "utf8" }));
  const programId = new PublicKey(arg("program") ?? idl.address);
  const conn = new Connection(RPC, { commitment: "confirmed", fetch: sdk.politeFetch({ minIntervalMs: 250, maxRetries: 12 }) as any, disableRetryOnRateLimit: true });
  const client = new sdk.BasketClient(conn, { programId, shareMint: new PublicKey(shareMint) });
  const v = await client.fetchBasket(); // fails loudly if the basket isn't on devnet
  for (const [i, l] of v.legs.entries()) {
    const r = reg.legs.find((x: any) => x.mint === l.mint.toBase58());
    if (!r) throw new Error(`basket leg ${i} mint ${l.mint.toBase58()} is not in C's registry`);
  }
  // Upgrade authority, read from the program's ProgramData account (disclosed in the app).
  const prog = await conn.getAccountInfo(programId);
  let upgradeAuthority: string | null = null;
  if (prog && prog.data.length >= 36) {
    const pd = await conn.getAccountInfo(new PublicKey(prog.data.subarray(4, 36)));
    if (pd && pd.data[12] === 1) upgradeAuthority = new PublicKey(pd.data.subarray(13, 45)).toBase58();
  }
  const env = {
    rpc: RPC, programId: programId.toBase58(), shareMint, basket: client.address.toBase58(), usdc: v.basket.usdcMint.toBase58(),
    legs: v.legs.map((l) => ({ symbol: l.symbol, mint: l.mint.toBase58() })),
    issuerKey: "(Agent C's; issuer steps run through C's scripts)", funderKey: `${process.env.HOME}/.config/solana/stocklana/app.json`,
    fixtureAmm: reg.fixture_amm?.program_id ?? null, registrySource: arg("registry") ?? `ops:fixtures/registry.json`,
    programs: {
      basket: { builtFrom: arg("program-commit") ?? "program branch (see Agent A's tests/program/devnet/canonical.json)", id: programId.toBase58(), upgradeAuthority: upgradeAuthority ?? null },
      fixtureAmm: { id: reg.fixture_amm?.program_id ?? null, source: "Agent C, ops:fixtures/registry.json" },
    },
    valuationApi: arg("valuation-url") ? { url: arg("valuation-url"), commit: arg("valuation-commit") ?? null, pricing: "mainnet-mirror: devnet balances, mainnet prices of the real tokens each fixture mirrors" } : null,
    lookupTable: arg("lookup-table") ?? null,
    basketReadAtSlot: v.slot, createdAt: new Date().toISOString(),
  };
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "env.json"), JSON.stringify(env, null, 2));
  writeFileSync(join(APP, "public/config.json"), JSON.stringify({
    cluster: "devnet", clusterLabel: "devnet", rpcUrl: RPC, programId: env.programId, shareMint, lookupTable: arg("lookup-table") ?? null,
    valuationApiUrl: arg("valuation-url") ?? null,
    router: env.fixtureAmm ? { kind: "fixture_amm", programId: env.fixtureAmm } : { kind: "none" },
    upgradeAuthority: upgradeAuthority ?? "none (immutable)", explorerTx: "https://explorer.solana.com/tx/{sig}?cluster=devnet",
  }, null, 2));
  console.log(`devnet env written: basket ${env.basket}, ${env.legs.length} legs, read at slot ${v.slot}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
