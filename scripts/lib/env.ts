// Cluster, key and path configuration for every ops script.
// Safety rules enforced here, not by convention:
//  - write scripts refuse mainnet outright;
//  - keys come only from ~/.config/solana/stocklana/ (never id.json, never another project's keys);
//  - every spl-token/solana CLI call passes an explicit -C config that points at stocklana keys.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { Rpc } from "../../services/valuation/src/lib/rpc.ts";

export const REPO = resolve(import.meta.dirname, "..", "..");
export const KEY_DIR = join(homedir(), ".config", "solana", "stocklana");
export const ISSUER_KEY = join(KEY_DIR, "fixture-issuer.json");
export const OPS_KEY = join(KEY_DIR, "ops.json");

export type Cluster = "local" | "devnet";

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function cluster(): Cluster {
  const c = arg("cluster", "local")!;
  if (c === "mainnet" || c === "mainnet-beta" || c.includes("mainnet")) {
    throw new Error("refusing: ops write scripts never touch mainnet (mainnet is read-only)");
  }
  if (c !== "local" && c !== "devnet") throw new Error(`unknown cluster ${c}`);
  return c;
}

export function rpcUrl(c: Cluster): string {
  return c === "local" ? (process.env.LOCAL_RPC ?? "http://127.0.0.1:8901") : (process.env.DEVNET_RPC ?? "https://api.devnet.solana.com");
}

export function rpcFor(c: Cluster): Rpc {
  return new Rpc(c, [rpcUrl(c)], "confirmed");
}

export const mainnet = () => new Rpc("mainnet", undefined, "confirmed");

/** A CLI config that makes the default signer the fixture issuer, so nothing can fall back to id.json. */
export function cliConfig(c: Cluster): string {
  const p = join(KEY_DIR, `cli-ops-${c}.yml`);
  writeFileSync(
    p,
    `---\njson_rpc_url: ${rpcUrl(c)}\nwebsocket_url: ''\nkeypair_path: ${ISSUER_KEY}\ncommitment: confirmed\n`,
  );
  return p;
}

export function loadKeypair(path: string): Keypair {
  if (!resolve(path).startsWith(KEY_DIR + "/")) throw new Error(`refusing key outside ${KEY_DIR}: ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export function registryPath(c: Cluster): string {
  return c === "devnet" ? join(REPO, "fixtures", "registry.json") : join(REPO, "fixtures", ".local", "registry.json");
}

export function scenarioDir(c: Cluster): string {
  return c === "devnet" ? join(REPO, "fixtures", "scenarios") : join(REPO, "fixtures", ".local", "scenarios");
}

export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
}

export function loadRegistry(c: Cluster): any {
  const p = registryPath(c);
  if (!existsSync(p)) throw new Error(`no registry at ${p}; run fixtures/create-mints first`);
  return readJson(p);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
