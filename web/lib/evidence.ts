// Evidence for the landing page. lib/evidence.json is generated from the committed records by
// scripts/gen-evidence.py and checked on chain by scripts/verify-evidence.mjs (run before every build).
import raw from "./evidence.json";

export type Network = "devnet" | "mainnet";
export type Tx = { label: string; signature: string; slot: number | null; network: Network; record: string };

type Evidence = {
  survive: Tx[];
  seizure: Tx[];
  browser: {
    wallet: string;
    steps: Tx[];
    paidNow: Record<string, string>;
    claim: { leg: string; units: string; reason: string };
    settled: { received: string; appEstimate: string; feeBps: number };
  };
  proofTable: (Tx & { scenario: string })[];
  deposit: Tx[];
  deploy: { program: string; signature: string; slot: number; sha256: string; network: Network };
  feeChanges: { mint: string; signature: string; network: Network }[];
  multiplier: { mint: string; multiplier: string; signed: string; effective: string; warning: string; signature: string; network: Network }[];
  seizureMainnet: { signature: string; network: Network }[];
  fork: { forkStartSlot: number; record: string };
  symmetry: {
    program: string;
    pauseReceived: number;
    seizeReceived: number;
    reconSlot: number;
    vaultsScanned: number;
  };
};

export const evidence = raw as unknown as Evidence;

export const REPO = "https://github.com/Unlisted-Org/unlisted";
export const recordUrl = (path: string) => `${REPO}/blob/main/${path}`;
export const explorerTx = (sig: string, network: Network) =>
  `https://explorer.solana.com/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;
