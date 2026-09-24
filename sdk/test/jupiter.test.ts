import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { JupiterRouter } from "../src/routers/jupiter.js";
import { MAINNET_USDC } from "../src/constants.js";

// Recorded api.jup.ag/swap/v2/build response (USDC → ANTHROPIC, 25 USDC, maxAccounts=30,
// excludeDexes=Manifest, taker = an off-curve PDA, destinationTokenAccount overridden).
const rec = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/jupiter-build-usdc-anthropic.json", import.meta.url)), "utf8"));
const req = {
  inputMint: MAINNET_USDC, outputMint: new PublicKey("Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw"), amount: 25_000_000n,
  taker: new PublicKey("BtY3Q8VhpSCLZ3Frkp3gpCrQzPFfaABcZagimJrudzdX"), destination: new PublicKey("Vote111111111111111111111111111111111111111"), slippageBps: 150,
};

describe("JupiterRouter", () => {
  it("builds the /build URL with maxAccounts=30 and excludeDexes=Manifest", () => {
    const u = new URL(new JupiterRouter().buildUrl(req));
    expect(u.searchParams.get("maxAccounts")).toBe("30");
    expect(u.searchParams.get("excludeDexes")).toBe("Manifest");
    expect(u.searchParams.get("taker")).toBe(req.taker.toBase58());
    expect(u.searchParams.get("destinationTokenAccount")).toBe(req.destination.toBase58());
  });
  it("parses a recorded route: only the taker signs, the destination is in the route", () => {
    const r = JupiterRouter.parse(rec, req);
    expect(r.routeAccounts.filter((a) => a.isSigner).map((a) => a.pubkey.toBase58())).toEqual([req.taker.toBase58()]);
    expect(r.routeAccounts.some((a) => a.pubkey.equals(req.destination))).toBe(true);
    expect(r.quotedOut).toBe(BigInt(rec.outAmount));
    expect(r.lookupTables.length).toBeGreaterThan(0);
  });
  it("refuses a route whose destination was not honoured", () => {
    expect(() => JupiterRouter.parse(rec, { ...req, destination: PublicKey.default })).toThrow(/destination/);
  });
});
