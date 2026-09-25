// The holder app's runtime config (read by app/app/_holder/config.ts from /config.json).
// Built from the environment at request time, so no key is ever committed:
//   HELIUS_API_KEY     -> the devnet RPC (visible to visitors' browsers by necessity; restrict the key
//                         to the site's domain in the Helius dashboard, see docs/deploy.md)
//   VALUATION_API_URL  -> Agent C's valuation API (default: a local one on port 8907)
// Devnet only: config.ts refuses any other cluster or a mainnet RPC.
export const dynamic = "force-dynamic";

export function GET() {
  const key = process.env.HELIUS_API_KEY;
  return Response.json(
    {
      cluster: "devnet",
      clusterLabel: "devnet",
      rpcUrl: key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "https://api.devnet.solana.com",
      programId: "GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv",
      shareMint: "HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj",
      lookupTable: "9yH9RSWpNhjZuZgvatW5wzq4uKiXP4zj47jeUgv7uyFc",
      valuationApiUrl: process.env.VALUATION_API_URL ?? "http://127.0.0.1:8907",
      router: { kind: "fixture_amm", programId: "aznyZehUyR37Zr9iRM22jgWoPQ43PznYB9TDUxYMTqF" },
      upgradeAuthority: "DBJ6FdxbtWEZsVjUsZ3PBMefpxvmtQX8pMp7sDULoFgb",
      explorerTx: "https://explorer.solana.com/tx/{sig}?cluster=devnet",
      // A dedicated RPC doesn't need the public endpoint's spacing, and serves a fresh blockhash reliably
      // (fastRpc: "confirmed" blockhash, fast confirmation polling; see app/app/_holder/send.ts).
      ...(key ? { rpcMinIntervalMs: 60, rpcConcurrency: 3, refreshMs: 15000, fastRpc: true } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
