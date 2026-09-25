import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Basket, decodeBasket, encodeBasket, decodeRedemptionTicket, encodeRedemptionTicket, decodeDepositTicket, encodeDepositTicket, openClaims,
  RedemptionTicket,
} from "../src/accounts.js";
import { INDEX_ONE, MAX_LEGS } from "../src/constants.js";
import { discriminator } from "../src/codec.js";
import { encodeEvent, parseEventsFromLogs, decodeEventData } from "../src/events.js";
import * as ix from "../src/instructions.js";
import { basketPda, redemptionTicketPda } from "../src/pda.js";

const pk = () => Keypair.generate().publicKey;

function sampleBasket(): Basket {
  return {
    version: 1, bump: 254, authority: pk(), shareMint: pk(), usdcMint: pk(), usdcReserve: pk(), accountedUsdcReserve: 0n, nLegs: 7,
    legs: Array.from({ length: MAX_LEGS }, (_, i) => ({
      mint: pk(), vault: pk(), accounted: 10n ** 12n + BigInt(i), claimUnits: BigInt(i * 7), pendingNorm: (1n << 100n) + BigInt(i),
      lossIndex: INDEX_ONE - BigInt(i),
      status: i === 2 ? { kind: "Listing" as const, convertAfter: 1_800_000_000n, deadline: 1_800_700_000n } : i === 7 ? { kind: "Retired" as const } : { kind: "Active" as const },
      mirrorOf: pk(),
    })),
    routerAllowlist: [pk(), PublicKey.default, PublicKey.default, PublicKey.default],
    pendingRouter: { router: pk(), effectiveTs: 1_790_000_000n }, maxConvertChunk: 5n * 10n ** 9n, depositsEnabled: true, bootstrapped: true,
  };
}

describe("account codecs", () => {
  it("Basket round-trips, including enum variants of different sizes", () => {
    const b = sampleBasket();
    const d = decodeBasket(encodeBasket(b));
    expect(d.legs[2].status).toEqual(b.legs[2].status);
    expect(d.legs[7].status).toEqual({ kind: "Retired" });
    expect(d.legs[6].pendingNorm).toBe(b.legs[6].pendingNorm);
    expect(d.pendingRouter!.router.equals(b.pendingRouter!.router)).toBe(true);
    expect(d.maxConvertChunk).toBe(b.maxConvertChunk);
    expect(d.bootstrapped).toBe(true);
  });

  it("rejects an account with the wrong discriminator", () => {
    const data = encodeBasket(sampleBasket());
    data[0] ^= 1;
    expect(() => decodeBasket(data)).toThrow(/discriminator/);
  });

  it("RedemptionTicket round-trips and lists open claims only", () => {
    const t: RedemptionTicket = {
      basket: pk(), owner: pk(), nonce: 42n, bump: 250, mode: { kind: "Usdc", minUsdcOut: 123n }, sharesBurned: 5n * 10n ** 8n,
      legs: [
        { kind: "Paid", amount: 99n, received: 98n }, { kind: "Claim", units: 5n * 10n ** 8n, reason: "Paused" }, { kind: "None" },
        { kind: "Claim", units: 0n, reason: "Frozen" }, { kind: "Claim", units: 7n, reason: "PendingSale" },
        { kind: "Paid", amount: 1n, received: 0n }, { kind: "Paid", amount: 2n, received: 1n }, { kind: "None" },
      ],
      usdcOut: 0n,
    };
    const d = decodeRedemptionTicket(encodeRedemptionTicket(t));
    expect(d.mode).toEqual({ kind: "Usdc", minUsdcOut: 123n });
    expect(openClaims(d)).toEqual([{ leg: 1, units: 5n * 10n ** 8n, reason: "Paused" }, { leg: 4, units: 7n, reason: "PendingSale" }]);
  });

  it("DepositTicket round-trips", () => {
    const t = { basket: pk(), owner: pk(), nonce: 9n, bump: 1, escrow: pk(), usdcIn: 10_000_000n, norm: Array.from({ length: 8 }, (_, i) => BigInt(i) << 70n),
      landedMask: 0b1111111, createdSlot: 100n, expirySlot: 1600n };
    expect(decodeDepositTicket(encodeDepositTicket(t))).toEqual(t);
  });
});

describe("events", () => {
  it("decodes only the basket program's Program data lines", () => {
    const program = pk();
    const owner = pk();
    const ticket = pk();
    const ev = { name: "ClaimCreated" as const, owner, ticket, leg: 3, units: 1234n, reason: "Paused" as const };
    const b64 = Buffer.from(encodeEvent(ev)).toString("base64");
    const router = pk().toBase58();
    const logs = [
      `Program ${program.toBase58()} invoke [1]`,
      `Program ${router} invoke [2]`,
      `Program data: ${b64}`, // emitted by the router, must be ignored
      `Program ${router} success`,
      `Program data: ${b64}`,
      `Program ${program.toBase58()} success`,
    ];
    const out = parseEventsFromLogs(logs, program);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "ClaimCreated", leg: 3, units: 1234n, reason: "Paused" });
  });

  it("round-trips ShortfallObserved with a u128 loss index", () => {
    const ev = { name: "ShortfallObserved" as const, leg: 1, expected: 10n ** 12n, actual: 75n * 10n ** 10n, lossIndex: 75n * 10n ** 16n, slot: 5n };
    expect(decodeEventData(encodeEvent(ev))).toEqual(ev);
  });
});

describe("instruction builders", () => {
  const programId = pk();
  it("discriminators are Anchor's sha256('global:<name>')", () => {
    const b = ix.settleClaim({ programId, cranker: pk(), basket: pk(), ticket: pk(), legMint: pk(), legVault: pk(), ownerTokenAccount: pk(), leg: 3, shareMint: pk() });
    expect(Buffer.from(b.ix.data.subarray(0, 8))).toEqual(Buffer.from(discriminator("global", "settle_claim")));
    expect(b.ix.data[8]).toBe(3);
    expect(b.ix.keys.map((k) => k.isSigner)).toEqual([true, false, false, false, false, false, false, false]);
  });

  it("redeem: named accounts first, then (mint, vault, user ata) per leg; args nonce, shares, mode", () => {
    const shareMint = pk();
    const [basket] = basketPda(programId, shareMint);
    const owner = pk();
    const [ticket] = redemptionTicketPda(programId, basket, owner, 7n);
    const legs = Array.from({ length: 7 }, () => ({ mint: pk(), vault: pk(), userTokenAccount: pk() }));
    const b = ix.redeem({ programId, owner, basket, shareMint, ownerShareAta: pk(), ticket, usdcReserve: null, legs, nonce: 7n, shares: 5n, mode: { kind: "InKind" } });
    expect(b.named.map((n) => n.name)).toEqual(["owner", "basket", "share_mint", "owner_share_ata", "ticket", "usdc_reserve", "owner_usdc", "token_program", "token_2022_program", "system_program"]);
    expect(b.ix.keys).toHaveLength(10 + 21);
    expect(b.ix.keys[10].pubkey.equals(legs[0].mint)).toBe(true);
    expect(b.ix.keys[11].isWritable).toBe(true);
    expect(b.ix.data.length).toBe(8 + 8 + 8 + 1);
    expect(b.ix.data.readBigUInt64LE(8)).toBe(7n);
    expect(b.ix.data.readBigUInt64LE(16)).toBe(5n);
  });

  it("ticket_swap_leg clears signer flags on route accounts (the ticket PDA signs inside the CPI)", () => {
    const taker = pk();
    const b = ix.ticketSwapLeg({ programId, owner: pk(), basket: pk(), ticket: taker, escrow: pk(), legMint: pk(), legVault: pk(), routerProgram: pk(),
      routeAccounts: [{ pubkey: taker, isSigner: true, isWritable: false }, { pubkey: pk(), isSigner: false, isWritable: true }],
      leg: 2, usdcAmount: 10n, minOut: 9n, routeData: new Uint8Array([1, 2, 3]) });
    expect(b.ix.keys.filter((k) => k.isSigner)).toHaveLength(1);
    expect([...b.ix.data.subarray(8)]).toEqual([2, 10, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 1, 2, 3]);
  });

  it("has a builder for every spec 02 instruction", () => {
    const names = new Set(Object.values(ix).filter((f) => typeof f === "function").map((f) => (f as Function).name));
    const toCamel = (s: string) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    for (const n of ix.SPEC_INSTRUCTIONS) {
      const fn = n === "observe" ? "observeIx" : toCamel(n);
      expect(names.has(fn), fn).toBe(true);
    }
  });
});
