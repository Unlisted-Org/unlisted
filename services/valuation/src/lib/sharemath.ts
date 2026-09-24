// Spec 01 share maths on raw integers (BigInt), mirroring spec/model/basket_model.py.
// The API only *quotes*; the program is the source of truth. Tests compare these against the model.

import { transferFee } from "./token2022.ts";

export const INDEX_ONE = 10n ** 18n;

export interface LegState {
  balance: bigint; // B_i: actual vault balance (read live)
  accounted: bigint; // A_i
  claim_units: bigint; // C_i
  pending_norm: bigint; // P_i
  loss_index: bigint; // L_i
  available: boolean;
  unavailable_reason: string | null;
  retired: boolean;
  fee_bps: number; // fee in force now on the leg mint
  maximum_fee: bigint;
}

/** observe(i): what the program does first on every instruction touching leg i. Pure: returns a copy. */
export function observe(l: LegState): LegState & { shortfall: bigint; surplus: bigint } {
  let loss_index = l.loss_index;
  let shortfall = 0n, surplus = 0n;
  if (l.balance < l.accounted) {
    shortfall = l.accounted - l.balance;
    loss_index = (l.loss_index * l.balance) / l.accounted;
  } else if (l.balance > l.accounted) {
    surplus = l.balance - l.accounted;
  }
  return { ...l, loss_index, accounted: l.balance, shortfall, surplus };
}

export const pendingActual = (l: LegState) => (l.pending_norm * l.loss_index) / INDEX_ONE;
export const owned = (l: LegState) => l.balance - pendingActual(l);

/** Exact per-share ratio owned_i / (S + C_i), after observe. */
export function perShare(l: LegState, supply: bigint): { num: bigint; den: bigint } {
  const o = observe(l);
  return { num: owned(o), den: supply + o.claim_units };
}

/** Raw amount of leg i that `shares` are entitled to right now: floor(s * owned / (S + C)). */
export function entitlement(l: LegState, supply: bigint, shares: bigint): bigint {
  const { num, den } = perShare(l, supply);
  return den === 0n ? 0n : (shares * num) / den;
}

export type RedeemLeg =
  | { index: number; action: "pay"; gross_raw: bigint; fee_raw: bigint; net_raw: bigint }
  | { index: number; action: "claim"; units: bigint; reason: string }
  | { index: number; action: "pending_sale"; units: bigint; gross_raw_if_settled_now: bigint; fee_raw: bigint };

/**
 * What redeem(s, mode) pays per leg at the state given (spec 01, Redeem), S = supply before the burn.
 * In kind: available legs pay floor(s * owned / (S + C)) now; the recipient receives it minus the fee.
 * Usdc: every active leg becomes a PendingSale claim of s units; its sale amount if settled now is shown.
 * Unavailable legs become claims of s units in both modes.
 */
export function quoteRedeem(legs: LegState[], supply: bigint, shares: bigint, mode: "in_kind" | "usdc"): RedeemLeg[] {
  const out: RedeemLeg[] = [];
  legs.forEach((l, index) => {
    if (l.retired) return;
    if (!l.available) {
      out.push({ index, action: "claim", units: shares, reason: l.unavailable_reason ?? "paused" });
      return;
    }
    const gross = entitlement(l, supply, shares);
    const fee = transferFee(gross, l.fee_bps, l.maximum_fee);
    if (mode === "in_kind") out.push({ index, action: "pay", gross_raw: gross, fee_raw: fee, net_raw: gross - fee });
    else out.push({ index, action: "pending_sale", units: shares, gross_raw_if_settled_now: gross, fee_raw: fee });
  });
  return out;
}

/**
 * Shares minted for measured deltas (spec 01 mint): min over active legs of floor(d * (S + C) / (owned - d)),
 * where owned already includes the delta. Here the deltas are *expected* (quote), not measured.
 */
export function sharesForDeltas(legs: LegState[], supply: bigint, deltas: bigint[]): bigint | null {
  let m: bigint | null = null;
  legs.forEach((l, i) => {
    if (l.retired) return;
    const o = observe(l);
    const ownedBefore = owned(o);
    if (ownedBefore <= 0n) { m = 0n; return; }
    const cand = (deltas[i] * (supply + o.claim_units)) / ownedBefore;
    m = m === null ? cand : (cand < m ? cand : m);
  });
  return m;
}
