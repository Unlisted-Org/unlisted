// Account decoders (and encoders, for tests and the local mock) for spec 02 "Accounts".
// Layout = Anchor Borsh: 8-byte discriminator, then fields in declaration order.
import { PublicKey } from "@solana/web3.js";
import { MAX_LEGS, ROUTER_ALLOWLIST_MAX } from "./constants.js";
import { Reader, Writer, bytesEqual, discriminator } from "./codec.js";

export type LegStatus =
  | { kind: "Active" }
  | { kind: "Listing"; convertAfter: bigint; deadline: bigint }
  | { kind: "Retired" };

export interface Leg {
  mint: PublicKey;
  vault: PublicKey;
  accounted: bigint; // A_i
  claimUnits: bigint; // C_i
  pendingNorm: bigint; // P_i
  lossIndex: bigint; // L_i
  status: LegStatus;
  mirrorOf: PublicKey;
}

export interface Basket {
  version: number;
  bump: number;
  authority: PublicKey;
  shareMint: PublicKey;
  usdcMint: PublicKey;
  usdcReserve: PublicKey;
  accountedUsdcReserve: bigint;
  nLegs: number;
  legs: Leg[]; // always MAX_LEGS entries on chain; slice(0, nLegs) for the live ones
  routerAllowlist: PublicKey[];
  pendingRouter: { router: PublicKey; effectiveTs: bigint } | null;
  maxConvertChunk: bigint;
  depositsEnabled: boolean;
  bootstrapped: boolean;
}

export interface DepositTicket {
  basket: PublicKey;
  owner: PublicKey;
  nonce: bigint;
  bump: number;
  escrow: PublicKey;
  usdcIn: bigint;
  norm: bigint[]; // MAX_LEGS
  landedMask: number;
  createdSlot: bigint;
  expirySlot: bigint;
}

export type ClaimReason = "Paused" | "Hook" | "Frozen" | "PendingSale";
export const CLAIM_REASONS: ClaimReason[] = ["Paused", "Hook", "Frozen", "PendingSale"];

export type TicketLeg =
  | { kind: "Paid"; amount: bigint }
  | { kind: "Claim"; units: bigint; reason: ClaimReason }
  | { kind: "None" };

export type RedeemMode = { kind: "InKind" } | { kind: "Usdc"; minUsdcOut: bigint };

export interface RedemptionTicket {
  basket: PublicKey;
  owner: PublicKey;
  nonce: bigint;
  bump: number;
  mode: RedeemMode;
  sharesBurned: bigint;
  legs: TicketLeg[]; // MAX_LEGS
  usdcOut: bigint;
}

export const ACCOUNT_DISCRIMINATORS = {
  Basket: discriminator("account", "Basket"),
  DepositTicket: discriminator("account", "DepositTicket"),
  RedemptionTicket: discriminator("account", "RedemptionTicket"),
};

function checkDisc(data: Uint8Array, name: keyof typeof ACCOUNT_DISCRIMINATORS): Reader {
  if (data.length < 8 || !bytesEqual(data.slice(0, 8), ACCOUNT_DISCRIMINATORS[name])) {
    throw new Error(`not a ${name} account (discriminator mismatch)`);
  }
  const r = new Reader(data);
  r.off = 8;
  return r;
}

// ---------- LegStatus ----------
function readLegStatus(r: Reader): LegStatus {
  const tag = r.u8();
  if (tag === 0) return { kind: "Active" };
  if (tag === 1) return { kind: "Listing", convertAfter: r.i64(), deadline: r.i64() };
  if (tag === 2) return { kind: "Retired" };
  throw new Error(`bad LegStatus tag ${tag}`);
}
function writeLegStatus(w: Writer, s: LegStatus) {
  if (s.kind === "Active") w.u8(0);
  else if (s.kind === "Listing") w.u8(1).i64(s.convertAfter).i64(s.deadline);
  else w.u8(2);
}

function readLeg(r: Reader): Leg {
  return {
    mint: r.pubkey(),
    vault: r.pubkey(),
    accounted: r.u64(),
    claimUnits: r.u64(),
    pendingNorm: r.u128(),
    lossIndex: r.u128(),
    status: readLegStatus(r),
    mirrorOf: r.pubkey(),
  };
}
function writeLeg(w: Writer, l: Leg) {
  w.pubkey(l.mint).pubkey(l.vault).u64(l.accounted).u64(l.claimUnits).u128(l.pendingNorm).u128(l.lossIndex);
  writeLegStatus(w, l.status);
  w.pubkey(l.mirrorOf);
}

export function decodeBasket(data: Uint8Array): Basket {
  const r = checkDisc(data, "Basket");
  return {
    version: r.u8(),
    bump: r.u8(),
    authority: r.pubkey(),
    shareMint: r.pubkey(),
    usdcMint: r.pubkey(),
    usdcReserve: r.pubkey(),
    accountedUsdcReserve: r.u64(),
    nLegs: r.u8(),
    legs: r.array(MAX_LEGS, () => readLeg(r)),
    routerAllowlist: r.array(ROUTER_ALLOWLIST_MAX, () => r.pubkey()),
    pendingRouter: r.option(() => ({ router: r.pubkey(), effectiveTs: r.i64() })),
    maxConvertChunk: r.u64(),
    depositsEnabled: r.bool(),
    bootstrapped: r.bool(),
  };
}

export function encodeBasket(b: Basket): Uint8Array {
  const w = new Writer().raw(ACCOUNT_DISCRIMINATORS.Basket);
  w.u8(b.version).u8(b.bump).pubkey(b.authority).pubkey(b.shareMint).pubkey(b.usdcMint).pubkey(b.usdcReserve);
  w.u64(b.accountedUsdcReserve).u8(b.nLegs);
  if (b.legs.length !== MAX_LEGS) throw new Error("legs must have MAX_LEGS entries");
  b.legs.forEach((l) => writeLeg(w, l));
  if (b.routerAllowlist.length !== ROUTER_ALLOWLIST_MAX) throw new Error("allowlist size");
  b.routerAllowlist.forEach((k) => w.pubkey(k));
  w.option(b.pendingRouter, (p) => w.pubkey(p.router).i64(p.effectiveTs));
  w.u64(b.maxConvertChunk).bool(b.depositsEnabled).bool(b.bootstrapped);
  return w.build();
}

export function decodeDepositTicket(data: Uint8Array): DepositTicket {
  const r = checkDisc(data, "DepositTicket");
  return {
    basket: r.pubkey(),
    owner: r.pubkey(),
    nonce: r.u64(),
    bump: r.u8(),
    escrow: r.pubkey(),
    usdcIn: r.u64(),
    norm: r.array(MAX_LEGS, () => r.u128()),
    landedMask: r.u8(),
    createdSlot: r.u64(),
    expirySlot: r.u64(),
  };
}

export function encodeDepositTicket(t: DepositTicket): Uint8Array {
  const w = new Writer().raw(ACCOUNT_DISCRIMINATORS.DepositTicket);
  w.pubkey(t.basket).pubkey(t.owner).u64(t.nonce).u8(t.bump).pubkey(t.escrow).u64(t.usdcIn);
  t.norm.forEach((n) => w.u128(n));
  w.u8(t.landedMask).u64(t.createdSlot).u64(t.expirySlot);
  return w.build();
}

function readTicketLeg(r: Reader): TicketLeg {
  const tag = r.u8();
  if (tag === 0) return { kind: "Paid", amount: r.u64() };
  if (tag === 1) {
    const units = r.u64();
    const reasonTag = r.u8();
    const reason = CLAIM_REASONS[reasonTag];
    if (!reason) throw new Error(`bad ClaimReason ${reasonTag}`);
    return { kind: "Claim", units, reason };
  }
  if (tag === 2) return { kind: "None" };
  throw new Error(`bad TicketLeg tag ${tag}`);
}
function writeTicketLeg(w: Writer, l: TicketLeg) {
  if (l.kind === "Paid") w.u8(0).u64(l.amount);
  else if (l.kind === "Claim") w.u8(1).u64(l.units).u8(CLAIM_REASONS.indexOf(l.reason));
  else w.u8(2);
}

export function readRedeemMode(r: Reader): RedeemMode {
  const tag = r.u8();
  if (tag === 0) return { kind: "InKind" };
  if (tag === 1) return { kind: "Usdc", minUsdcOut: r.u64() };
  throw new Error(`bad RedeemMode ${tag}`);
}
export function writeRedeemMode(w: Writer, m: RedeemMode) {
  if (m.kind === "InKind") w.u8(0);
  else w.u8(1).u64(m.minUsdcOut);
}

export function decodeRedemptionTicket(data: Uint8Array): RedemptionTicket {
  const r = checkDisc(data, "RedemptionTicket");
  return {
    basket: r.pubkey(),
    owner: r.pubkey(),
    nonce: r.u64(),
    bump: r.u8(),
    mode: readRedeemMode(r),
    sharesBurned: r.u64(),
    legs: r.array(MAX_LEGS, () => readTicketLeg(r)),
    usdcOut: r.u64(),
  };
}

export function encodeRedemptionTicket(t: RedemptionTicket): Uint8Array {
  const w = new Writer().raw(ACCOUNT_DISCRIMINATORS.RedemptionTicket);
  w.pubkey(t.basket).pubkey(t.owner).u64(t.nonce).u8(t.bump);
  writeRedeemMode(w, t.mode);
  w.u64(t.sharesBurned);
  t.legs.forEach((l) => writeTicketLeg(w, l));
  w.u64(t.usdcOut);
  return w.build();
}

/** Offsets for getProgramAccounts memcmp filters (owner sits right after basket in both tickets). */
export const TICKET_OWNER_OFFSET = 8 + 32;
export const TICKET_BASKET_OFFSET = 8;

/** Open claims on a redemption ticket, one per leg. */
export function openClaims(t: RedemptionTicket): { leg: number; units: bigint; reason: ClaimReason }[] {
  const out: { leg: number; units: bigint; reason: ClaimReason }[] = [];
  t.legs.forEach((l, i) => {
    if (l.kind === "Claim" && l.units > 0n) out.push({ leg: i, units: l.units, reason: l.reason });
  });
  return out;
}
