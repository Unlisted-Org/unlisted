// Runtime config, loaded from /config.json (written by the local e2e setup or the devnet deploy).
import { PublicKey } from "@solana/web3.js";

export interface AppConfig {
  /** "devnet" or "localnet". Anything else is refused: this app never talks to mainnet. */
  cluster: "devnet" | "localnet";
  /** Shown on every screen next to values, e.g. "local validator, not devnet". */
  clusterLabel: string;
  rpcUrl: string;
  programId: PublicKey;
  shareMint: PublicKey;
  lookupTable: PublicKey | null;
  /** Agent C's valuation API (spec 03). null = mock from spec 03's example shape, labelled as such. */
  valuationApiUrl: string | null;
  /** Router for USDC tickets and USDC redemptions on this cluster. */
  router: { kind: "fixture_amm"; programId: PublicKey } | { kind: "none" };
  upgradeAuthority: string | null;
  explorerTx: string | null; // template with {sig}
  /** Chain re-read period, and minimum spacing between RPC requests (public devnet rate-limits per IP). */
  refreshMs: number;
  rpcMinIntervalMs: number;
  rpcConcurrency: number;
  /** A dedicated RPC: take a "confirmed" blockhash (about 13 s fresher than "finalized") and poll fast. */
  fastRpc: boolean;
}

export async function loadConfig(): Promise<AppConfig | { error: string }> {
  const url = new URLSearchParams(location.search).get("config") ?? "/config.json";
  let raw: any;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { error: `No app config at ${url} (HTTP ${res.status}). Run the local setup or add the devnet config.` };
    raw = await res.json();
  } catch (e) {
    return { error: `Could not load ${url}: ${e}` };
  }
  if (raw.cluster !== "devnet" && raw.cluster !== "localnet") return { error: `Refusing cluster "${raw.cluster}": devnet or localnet only.` };
  if (/mainnet/i.test(raw.rpcUrl)) return { error: "Refusing a mainnet RPC URL." };
  return {
    cluster: raw.cluster,
    clusterLabel: raw.clusterLabel ?? raw.cluster,
    rpcUrl: raw.rpcUrl,
    programId: new PublicKey(raw.programId),
    shareMint: new PublicKey(raw.shareMint),
    lookupTable: raw.lookupTable ? new PublicKey(raw.lookupTable) : null,
    valuationApiUrl: raw.valuationApiUrl ?? null,
    router: raw.router?.kind === "fixture_amm" ? { kind: "fixture_amm", programId: new PublicKey(raw.router.programId) } : { kind: "none" },
    upgradeAuthority: raw.upgradeAuthority ?? null,
    explorerTx: raw.explorerTx ?? (raw.cluster === "devnet" ? "https://explorer.solana.com/tx/{sig}?cluster=devnet" : null),
    refreshMs: Number(raw.refreshMs ?? (raw.cluster === "devnet" ? 20_000 : 8_000)),
    rpcMinIntervalMs: Number(raw.rpcMinIntervalMs ?? (raw.cluster === "devnet" ? 200 : 0)),
    rpcConcurrency: Number(raw.rpcConcurrency ?? (raw.cluster === "devnet" ? 1 : 4)),
    fastRpc: raw.fastRpc === true,
  };
}
