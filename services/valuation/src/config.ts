// Service configuration from environment variables (all optional; defaults target devnet).
//
//   CLUSTER            devnet | local                     basket side (default devnet)
//   REGISTRY           path to registry.json               default fixtures/registry.json (local: fixtures/.local/registry.json)
//   BASKET_SOURCE      program | standin                   default: program if BASKET_SHARE_MINT is set, else standin
//   BASKET_PROGRAM     basket program id                   default: IDL address
//   BASKET_SHARE_MINT  share mint (Basket PDA = ["basket", share_mint])
//   IDL_PATH           A's IDL (programs/basket/idl/basket.json)
//   STANDIN_STATE      stand-in basket state file          default fixtures/standin-basket.json (local: fixtures/.local/…)
//   PORT               default 8905
//   POLL_S             watcher poll interval, default 60
//   DATA_DIR           watcher store, default services/valuation/.data
//   MAINNET_RPC, DEVNET_RPC, LOCAL_RPC, JUP_API_KEY

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Rpc } from "./lib/rpc.ts";
import { loadIdl } from "./lib/idl.ts";
import { PRESTOCKS_MULTISIG, PRESTOCKS_MULTISIG_VAULT } from "./lib/prestocks.ts";
import type { BasketConfig } from "./lib/basket.ts";
import type { WatchTarget } from "./watcher.ts";

export const REPO = resolve(import.meta.dirname, "..", "..", "..");

export function loadConfig() {
  const cluster = process.env.CLUSTER ?? "devnet";
  if (cluster !== "devnet" && cluster !== "local") throw new Error(`CLUSTER must be devnet or local, got ${cluster}`);
  const local = cluster === "local";
  const registryPath = process.env.REGISTRY ?? join(REPO, "fixtures", local ? ".local/registry.json" : "registry.json");
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const shareMint = process.env.BASKET_SHARE_MINT;
  const source = (process.env.BASKET_SOURCE ?? (shareMint ? "program" : "standin")) as "program" | "standin";
  const idlPath = process.env.IDL_PATH;
  const idl = idlPath && existsSync(idlPath) ? loadIdl(idlPath) : undefined;
  const basket: BasketConfig = {
    source,
    cluster,
    registry,
    program: process.env.BASKET_PROGRAM ?? idl?.address,
    shareMint,
    idl,
    standinStatePath: process.env.STANDIN_STATE ?? join(REPO, "fixtures", local ? ".local/standin-basket.json" : "standin-basket.json"),
  };
  if (source === "program" && (!idl || !shareMint)) throw new Error("BASKET_SOURCE=program needs IDL_PATH and BASKET_SHARE_MINT");
  const rpc = new Rpc(cluster);
  const mainnet = new Rpc("mainnet");
  const legsMints = registry.legs.map((l: any) => ({ index: l.index, symbol: l.symbol, fixture: l.mint, mainnet: l.mirror_of }));
  const targets: WatchTarget[] = [
    { cluster: "mainnet", rpc: mainnet, mints: legsMints.map((l: any) => ({ mint: l.mainnet, symbol: l.symbol, index: l.index })), authority: PRESTOCKS_MULTISIG_VAULT, multisig: PRESTOCKS_MULTISIG, backfill: Number(process.env.MAINNET_BACKFILL ?? 60) },
    { cluster, rpc, mints: legsMints.map((l: any) => ({ mint: l.fixture, symbol: l.symbol, index: l.index })), authority: registry.fixture_issuer, backfill: Number(process.env.FIXTURE_BACKFILL ?? 500) },
  ];
  return {
    cluster, registry, registryPath, basket, rpc, mainnet, targets,
    port: Number(process.env.PORT ?? 8905),
    pollS: Number(process.env.POLL_S ?? 60),
    dataPath: join(process.env.DATA_DIR ?? join(REPO, "services", "valuation", ".data"), `events-${cluster}.json`),
  };
}
export type Config = ReturnType<typeof loadConfig>;
