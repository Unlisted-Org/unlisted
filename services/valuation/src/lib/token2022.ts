// Interpretation of Token-2022 mint and account state, from the RPC's jsonParsed form.
// This file holds the ONLY implementation of the effective-multiplier rule (spec 01, spec 03).

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type Extensions = Record<string, any>;

/** jsonParsed mint/account `info` → { extensionName: state }. */
export function extensions(info: any): Extensions {
  const out: Extensions = {};
  for (const e of info?.extensions ?? []) out[e.extension] = e.state ?? {};
  return out;
}

export interface MultiplierView {
  stored: string;
  effective: string;
  effective_since: string | null; // ISO time the effective value took effect, if it came from newMultiplier
  pending: { multiplier: string; effective_at: string; effective_ts: number } | null;
  new_multiplier: string;
  new_multiplier_effective_ts: number;
}

/**
 * The effective scaled-UI multiplier, the single implementation:
 *   effective = (now >= newMultiplierEffectiveTimestamp) ? newMultiplier : multiplier
 * A mint without ScaledUiAmountConfig has multiplier 1.
 * Reading the stored `multiplier` alone is the bug that values OpenAI 1.486x wrong.
 */
export function effectiveMultiplier(mintInfo: any, nowUnix: number): MultiplierView {
  const cfg = extensions(mintInfo).scaledUiAmountConfig;
  if (!cfg) {
    return { stored: "1", effective: "1", effective_since: null, pending: null, new_multiplier: "1", new_multiplier_effective_ts: 0 };
  }
  const stored = String(cfg.multiplier);
  const next = String(cfg.newMultiplier);
  const ts = Number(cfg.newMultiplierEffectiveTimestamp ?? 0);
  const passed = nowUnix >= ts;
  const effective = passed ? next : stored;
  const differs = Number(next) !== Number(stored);
  return {
    stored,
    effective,
    effective_since: passed && differs && ts > 0 ? new Date(ts * 1000).toISOString().replace(".000Z", "Z") : null,
    pending: !passed && differs ? { multiplier: next, effective_at: new Date(ts * 1000).toISOString().replace(".000Z", "Z"), effective_ts: ts } : null,
    new_multiplier: next,
    new_multiplier_effective_ts: ts,
  };
}

export interface FeeView {
  now_bps: number;
  now_maximum_fee: string;
  pending: { bps: number; maximum_fee: string; effective_epoch: number } | null;
  older: { bps: number; epoch: number; maximum_fee: string };
  newer: { bps: number; epoch: number; maximum_fee: string };
  epoch: number;
}

/** Token-2022 rule: the newer fee applies from `newerTransferFee.epoch` onward, the older one before it. */
export function feeSchedule(mintInfo: any, epoch: number): FeeView | null {
  const cfg = extensions(mintInfo).transferFeeConfig;
  if (!cfg) return null;
  const older = { bps: cfg.olderTransferFee.transferFeeBasisPoints, epoch: cfg.olderTransferFee.epoch, maximum_fee: String(cfg.olderTransferFee.maximumFee) };
  const newer = { bps: cfg.newerTransferFee.transferFeeBasisPoints, epoch: cfg.newerTransferFee.epoch, maximum_fee: String(cfg.newerTransferFee.maximumFee) };
  const active = epoch >= newer.epoch ? newer : older;
  const pending = epoch < newer.epoch && (newer.bps !== older.bps || newer.maximum_fee !== older.maximum_fee)
    ? { bps: newer.bps, maximum_fee: newer.maximum_fee, effective_epoch: newer.epoch }
    : null;
  return { now_bps: active.bps, now_maximum_fee: active.maximum_fee, pending, older, newer, epoch };
}

/** Token-2022 fee on a transfer of `amount` raw: ceil(amount * bps / 10_000), capped at maximum_fee. */
export function transferFee(amount: bigint, bps: number, maximumFee: bigint = 2n ** 64n - 1n): bigint {
  if (bps === 0 || amount === 0n) return 0n;
  const fee = (amount * BigInt(bps) + 9_999n) / 10_000n;
  return fee > maximumFee ? maximumFee : fee;
}

export type Unavailable = "paused" | "hook" | "frozen";

/** Spec 02 availability: !paused && hook program null && vault state initialized. First failing reason wins. */
export function availability(mintInfo: any, vaultInfo: any | null): Unavailable | null {
  const x = extensions(mintInfo);
  if (x.pausableConfig?.paused) return "paused";
  if (x.transferHook && x.transferHook.programId) return "hook";
  if (vaultInfo && vaultInfo.state === "frozen") return "frozen";
  return null;
}

/** Every issuer control on a mint that /v1/issuer and the watcher report. */
export function issuerControls(mintInfo: any, epoch: number, nowUnix: number) {
  const x = extensions(mintInfo);
  return {
    fee: feeSchedule(mintInfo, epoch),
    paused: Boolean(x.pausableConfig?.paused),
    pause_authority: x.pausableConfig?.authority ?? null,
    hook_program: x.transferHook?.programId ?? null,
    hook_authority: x.transferHook?.authority ?? null,
    default_account_state: x.defaultAccountState?.accountState ?? null,
    permanent_delegate: x.permanentDelegate?.delegate ?? null,
    multiplier: effectiveMultiplier(mintInfo, nowUnix),
    multiplier_authority: x.scaledUiAmountConfig?.authority ?? null,
    mint_authority: mintInfo.mintAuthority ?? null,
    freeze_authority: mintInfo.freezeAuthority ?? null,
    fee_config_authority: x.transferFeeConfig?.transferFeeConfigAuthority ?? null,
    withdraw_withheld_authority: x.transferFeeConfig?.withdrawWithheldAuthority ?? null,
    supply_raw: String(mintInfo.supply),
    decimals: mintInfo.decimals,
  };
}

/** Flatten a parsed mint into dotted-path → value, for field-by-field diffs. */
export function flatten(value: any, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined || typeof value !== "object") {
    out[prefix] = value === null || value === undefined ? "null" : String(value);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out[prefix] = "[]";
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
