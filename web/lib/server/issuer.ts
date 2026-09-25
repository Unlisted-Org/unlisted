// Server-only: the devnet FIXTURE issuer, for the demo's issuer controls and the test-token faucet.
// The key comes from FIXTURE_ISSUER_KEY (a JSON byte array, set as an encrypted platform secret; never
// in the repo). It controls only the fixture mints on devnet; nothing here can touch mainnet.
import "server-only";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { timingSafeEqual } from "node:crypto";
import fixtures from "../fixtures.json";

export { fixtures };

export function devnet(): Connection {
  const key = process.env.HELIUS_API_KEY;
  const url = key ? `https://devnet.helius-rpc.com/?api-key=${key}` : "https://api.devnet.solana.com";
  if (/mainnet/i.test(url)) throw new Error("refusing a mainnet RPC");
  return new Connection(url, "confirmed");
}

let cached: Keypair | null = null;
export function issuer(): Keypair {
  if (cached) return cached;
  const raw = process.env.FIXTURE_ISSUER_KEY;
  if (!raw) throw Object.assign(new Error("the demo issuer isn't configured on this deployment"), { status: 503 });
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  if (!kp.publicKey.equals(new PublicKey(fixtures.fixtureIssuer)))
    throw Object.assign(new Error("configured key is not the fixture issuer"), { status: 500 });
  cached = kp;
  return kp;
}

/** Constant-time passcode check for the issuer controls. */
export function passcodeOk(given: unknown): boolean {
  const want = process.env.DEMO_PASSCODE;
  if (!want || typeof given !== "string") return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
