// Token-2022 mint/account reads the app needs, parsed straight from account data (TLV).
// Availability is computed exactly as spec 02 "Availability check" states, from the mint's
// extension data and the vault's account state, never from client-supplied flags.
import { PublicKey } from "@solana/web3.js";
import { BPS } from "./constants.js";
import { Reader } from "./codec.js";

export enum Ext {
  TransferFeeConfig = 1,
  ConfidentialTransferMint = 4,
  DefaultAccountState = 6,
  PermanentDelegate = 12,
  TransferHook = 14,
  ConfidentialTransferFeeConfig = 16,
  MetadataPointer = 18,
  TokenMetadata = 19,
  ScaledUiAmountConfig = 25,
  PausableConfig = 26,
}

const MINT_BASE = 82;
const ACCOUNT_BASE = 165;
const ACCOUNT_TYPE_MINT = 1;
const ACCOUNT_TYPE_ACCOUNT = 2;

function optKey(b: Uint8Array): PublicKey | null {
  return b.every((x) => x === 0) ? null : new PublicKey(b);
}

export function parseTlv(data: Uint8Array, expectType: number): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  if (data.length <= ACCOUNT_BASE) return out;
  if (data[ACCOUNT_BASE] !== expectType) throw new Error(`unexpected account type byte ${data[ACCOUNT_BASE]}`);
  let off = ACCOUNT_BASE + 1;
  while (off + 4 <= data.length) {
    const dv = new DataView(data.buffer, data.byteOffset + off, 4);
    const type = dv.getUint16(0, true);
    const len = dv.getUint16(2, true);
    if (type === 0) break;
    out.set(type, data.slice(off + 4, off + 4 + len));
    off += 4 + len;
  }
  return out;
}

export interface TransferFee { epoch: bigint; maximumFee: bigint; bps: number }
export interface MintInfo {
  supply: bigint;
  decimals: number;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
  extensions: number[];
  transferFee: { authority: PublicKey | null; withheld: bigint; older: TransferFee; newer: TransferFee } | null;
  paused: boolean | null; // null = no PausableConfig
  pauseAuthority: PublicKey | null;
  hookProgram: PublicKey | null;
  hookAuthority: PublicKey | null;
  permanentDelegate: PublicKey | null;
  defaultAccountState: number | null; // 1 initialized, 2 frozen
  scaledUi: { authority: PublicKey | null; multiplier: number; newMultiplierEffectiveTimestamp: bigint; newMultiplier: number } | null;
}

export function parseMint(data: Uint8Array): MintInfo {
  const r = new Reader(data);
  const mintAuthOpt = r.u32();
  const mintAuth = r.pubkey();
  const supply = r.u64();
  const decimals = r.u8();
  r.bool(); // is_initialized
  const freezeOpt = r.u32();
  const freeze = r.pubkey();
  const tlv = parseTlv(data, ACCOUNT_TYPE_MINT);
  const info: MintInfo = {
    supply,
    decimals,
    mintAuthority: mintAuthOpt ? mintAuth : null,
    freezeAuthority: freezeOpt ? freeze : null,
    extensions: [...tlv.keys()].sort((a, b) => a - b),
    transferFee: null,
    paused: null,
    pauseAuthority: null,
    hookProgram: null,
    hookAuthority: null,
    permanentDelegate: null,
    defaultAccountState: null,
    scaledUi: null,
  };
  const tf = tlv.get(Ext.TransferFeeConfig);
  if (tf) {
    const t = new Reader(tf);
    const authority = optKey(t.bytes(32));
    t.bytes(32); // withdraw_withheld_authority
    const withheld = t.u64();
    const fee = (): TransferFee => ({ epoch: t.u64(), maximumFee: t.u64(), bps: t.u16() });
    const older = fee();
    const newer = fee();
    info.transferFee = { authority, withheld, older, newer };
  }
  const p = tlv.get(Ext.PausableConfig);
  if (p) {
    info.pauseAuthority = optKey(p.slice(0, 32));
    info.paused = p[32] === 1;
  }
  const h = tlv.get(Ext.TransferHook);
  if (h) {
    info.hookAuthority = optKey(h.slice(0, 32));
    info.hookProgram = optKey(h.slice(32, 64));
  }
  const pd = tlv.get(Ext.PermanentDelegate);
  if (pd) info.permanentDelegate = optKey(pd.slice(0, 32));
  const das = tlv.get(Ext.DefaultAccountState);
  if (das) info.defaultAccountState = das[0];
  const s = tlv.get(Ext.ScaledUiAmountConfig);
  if (s) {
    const t = new Reader(s);
    info.scaledUi = {
      authority: optKey(t.bytes(32)),
      multiplier: t.f64(),
      newMultiplierEffectiveTimestamp: t.i64(),
      newMultiplier: t.f64(),
    };
  }
  return info;
}

export interface TokenAccountInfo {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  state: number; // 0 uninitialized, 1 initialized, 2 frozen
}

export function parseTokenAccount(data: Uint8Array): TokenAccountInfo {
  const r = new Reader(data);
  const mint = r.pubkey();
  const owner = r.pubkey();
  const amount = r.u64();
  r.u32();
  r.bytes(32); // delegate
  const state = r.u8();
  return { mint, owner, amount, state };
}

/** Fee schedule in force at `epoch` (Token-2022: newer applies from its epoch on). */
export function feeAt(info: MintInfo, epoch: bigint): TransferFee | null {
  if (!info.transferFee) return null;
  const { older, newer } = info.transferFee;
  return epoch >= newer.epoch ? newer : older;
}

/** Fee change scheduled for a later epoch, if any. */
export function pendingFee(info: MintInfo, epoch: bigint): TransferFee | null {
  if (!info.transferFee) return null;
  const { older, newer } = info.transferFee;
  return epoch < newer.epoch && newer.bps !== older.bps ? newer : null;
}

/** Token-2022 fee: ceil(amount × bps / 10_000), capped at maximumFee. Matches spec/model transfer_fee. */
export function transferFee(amount: bigint, fee: TransferFee | { bps: number; maximumFee?: bigint } | null): bigint {
  if (!fee || fee.bps === 0 || amount === 0n) return 0n;
  const f = (amount * BigInt(fee.bps) + BPS - 1n) / BPS;
  const cap = fee.maximumFee ?? f;
  return f < cap ? f : cap;
}

/** Gross amount to send so the recipient nets at least `net` (inverse of the ceil fee). */
export function grossForNet(net: bigint, fee: TransferFee | { bps: number; maximumFee?: bigint } | null): bigint {
  if (!fee || fee.bps === 0 || net === 0n) return net;
  let g = (net * BPS + (BPS - BigInt(fee.bps)) - 1n) / (BPS - BigInt(fee.bps));
  while (g - transferFee(g, fee) < net) g += 1n;
  while (g > 0n && g - 1n - transferFee(g - 1n, fee) >= net) g -= 1n;
  return g;
}

/** Scaled-UI multiplier in effect at unix time `now` (spec 01: display only). */
export function effectiveMultiplier(info: MintInfo, nowUnix: number): number {
  if (!info.scaledUi) return 1;
  const s = info.scaledUi;
  return BigInt(Math.floor(nowUnix)) >= s.newMultiplierEffectiveTimestamp ? s.newMultiplier : s.multiplier;
}

export type Unavailable = "paused" | "hook" | "frozen" | "vault_missing";

/** Spec 02 availability: !paused && hook == None && vault.state == Initialized. Returns every reason that holds. */
export function unavailableReasons(mint: MintInfo, vault: TokenAccountInfo | null): Unavailable[] {
  const reasons: Unavailable[] = [];
  if (mint.paused) reasons.push("paused");
  if (mint.hookProgram) reasons.push("hook");
  if (!vault) reasons.push("vault_missing");
  else if (vault.state !== 1) reasons.push("frozen");
  return reasons;
}
