// Event decoders for spec 02 "Events". Anchor `emit!` writes "Program data: <base64>" log
// lines: 8-byte discriminator sha256("event:<Name>")[0..8], then Borsh fields.
import { PublicKey } from "@solana/web3.js";
import { MAX_LEGS } from "./constants.js";
import { Reader, Writer, bytesEqual, discriminator } from "./codec.js";

export type BasketEvent =
  | { name: "ShortfallObserved"; leg: number; expected: bigint; actual: bigint; lossIndex: bigint; slot: bigint }
  | { name: "SurplusObserved"; leg: number; expected: bigint; actual: bigint; slot: bigint }
  | { name: "Minted"; owner: PublicKey; shares: bigint; deltas: bigint[]; path: "InKind" | "Ticket" | "Bootstrap" }
  | { name: "Redeemed"; owner: PublicKey; ticket: PublicKey; shares: bigint; paid: bigint[]; claimsMask: number }
  | { name: "ClaimCreated"; owner: PublicKey; ticket: PublicKey; leg: number; units: bigint; reason: "Paused" | "Hook" | "Frozen" }
  | { name: "ClaimSettled"; owner: PublicKey; ticket: PublicKey; leg: number; units: bigint; amount: bigint }
  | { name: "LegListing"; leg: number; convertAfter: bigint; deadline: bigint }
  | { name: "LegConverted"; leg: number; amount: bigint; usdc: bigint }
  | { name: "LegRetired"; leg: number }
  | { name: "RouterProposed"; router: PublicKey; effectiveTs: bigint };

const MINT_PATHS = ["InKind", "Ticket", "Bootstrap"] as const;
const UNAVAILABLE = ["Paused", "Hook", "Frozen"] as const;

const decoders: Record<string, (r: Reader) => BasketEvent> = {
  ShortfallObserved: (r) => ({ name: "ShortfallObserved", leg: r.u8(), expected: r.u64(), actual: r.u64(), lossIndex: r.u128(), slot: r.u64() }),
  SurplusObserved: (r) => ({ name: "SurplusObserved", leg: r.u8(), expected: r.u64(), actual: r.u64(), slot: r.u64() }),
  Minted: (r) => ({ name: "Minted", owner: r.pubkey(), shares: r.u64(), deltas: r.array(MAX_LEGS, () => r.u64()), path: MINT_PATHS[r.u8()] }),
  Redeemed: (r) => ({ name: "Redeemed", owner: r.pubkey(), ticket: r.pubkey(), shares: r.u64(), paid: r.array(MAX_LEGS, () => r.u64()), claimsMask: r.u8() }),
  ClaimCreated: (r) => ({ name: "ClaimCreated", owner: r.pubkey(), ticket: r.pubkey(), leg: r.u8(), units: r.u64(), reason: UNAVAILABLE[r.u8()] }),
  ClaimSettled: (r) => ({ name: "ClaimSettled", owner: r.pubkey(), ticket: r.pubkey(), leg: r.u8(), units: r.u64(), amount: r.u64() }),
  LegListing: (r) => ({ name: "LegListing", leg: r.u8(), convertAfter: r.i64(), deadline: r.i64() }),
  LegConverted: (r) => ({ name: "LegConverted", leg: r.u8(), amount: r.u64(), usdc: r.u64() }),
  LegRetired: (r) => ({ name: "LegRetired", leg: r.u8() }),
  RouterProposed: (r) => ({ name: "RouterProposed", router: r.pubkey(), effectiveTs: r.i64() }),
};

export const EVENT_NAMES = Object.keys(decoders);
const discs = EVENT_NAMES.map((n) => [n, discriminator("event", n)] as const);

export function decodeEventData(data: Uint8Array): BasketEvent | null {
  if (data.length < 8) return null;
  const head = data.slice(0, 8);
  for (const [n, d] of discs) {
    if (bytesEqual(head, d)) {
      const r = new Reader(data);
      r.off = 8;
      return decoders[n](r);
    }
  }
  return null;
}

function b64(s: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(s, "base64"));
}

/**
 * Decode events from a transaction's log messages, keeping only lines emitted while `programId`
 * is the executing program (so a router's own "Program data" lines are not misread).
 */
export function parseEventsFromLogs(logs: string[], programId: PublicKey): BasketEvent[] {
  const id = programId.toBase58();
  const stack: string[] = [];
  const out: BasketEvent[] = [];
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) { stack.push(invoke[1]); continue; }
    if (/^Program \w+ (success|failed)/.test(line)) { stack.pop(); continue; }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === id) {
      const ev = decodeEventData(b64(line.slice("Program data: ".length)));
      if (ev) out.push(ev);
    }
  }
  return out;
}

/** Encoder used by tests and the local mock to produce log lines the decoder must read back. */
export function encodeEvent(ev: BasketEvent): Uint8Array {
  const w = new Writer().raw(discriminator("event", ev.name));
  switch (ev.name) {
    case "ShortfallObserved": w.u8(ev.leg).u64(ev.expected).u64(ev.actual).u128(ev.lossIndex).u64(ev.slot); break;
    case "SurplusObserved": w.u8(ev.leg).u64(ev.expected).u64(ev.actual).u64(ev.slot); break;
    case "Minted": w.pubkey(ev.owner).u64(ev.shares); ev.deltas.forEach((d) => w.u64(d)); w.u8(MINT_PATHS.indexOf(ev.path)); break;
    case "Redeemed": w.pubkey(ev.owner).pubkey(ev.ticket).u64(ev.shares); ev.paid.forEach((d) => w.u64(d)); w.u8(ev.claimsMask); break;
    case "ClaimCreated": w.pubkey(ev.owner).pubkey(ev.ticket).u8(ev.leg).u64(ev.units).u8(UNAVAILABLE.indexOf(ev.reason)); break;
    case "ClaimSettled": w.pubkey(ev.owner).pubkey(ev.ticket).u8(ev.leg).u64(ev.units).u64(ev.amount); break;
    case "LegListing": w.u8(ev.leg).i64(ev.convertAfter).i64(ev.deadline); break;
    case "LegConverted": w.u8(ev.leg).u64(ev.amount).u64(ev.usdc); break;
    case "LegRetired": w.u8(ev.leg); break;
    case "RouterProposed": w.pubkey(ev.router).i64(ev.effectiveTs); break;
  }
  return w.build();
}
