// Read the basket's state at one slot: the Basket account (via A's IDL) or the stand-in basket, plus
// every vault, leg mint and the share mint in the SAME getMultipleAccounts call, so B_i, S and the
// mint controls are all read at the stated slot.
//
// Sources:
//  - "program": A's `basket` program. Basket PDA = ["basket", share_mint]. Layout from the IDL.
//  - "standin": until the program is on the cluster, a stand-in basket built by
//    scripts/fixtures/standin-basket.ts: real vault token accounts and a real share mint on chain,
//    with A_i, C_i, P_i, L_i kept in a JSON state file (what the program would store). Every response
//    says which source was read.

import { readFileSync } from "node:fs";
import { PublicKey } from "./web3.ts";
import { Rpc } from "./rpc.ts";
import { decodeAccount } from "./idl.ts";
import type { Idl } from "./idl.ts";
import { availability, effectiveMultiplier, feeSchedule } from "./token2022.ts";
import type { FeeView, MultiplierView } from "./token2022.ts";
import type { LegState } from "./sharemath.ts";

export interface BasketConfig {
  source: "program" | "standin";
  cluster: string;
  registry: any;
  program?: string;
  shareMint?: string;
  idl?: Idl;
  standinStatePath?: string;
}

export interface LegView {
  index: number;
  symbol: string;
  fixture_mint: string;
  mirror_of: string;
  vault: string;
  decimals: number;
  status: "active" | "unavailable" | "listing" | "retired";
  unavailable_reason: string | null;
  listing: { convert_after: string; deadline: string } | null;
  fee: FeeView;
  multiplier: MultiplierView;
  state: LegState;
  vault_state: string | null;
  mint_info: any;
}

export interface BasketView {
  source: "program" | "standin";
  cluster: string;
  program: string | null;
  basket: string;
  share_mint: string;
  share_decimals: number;
  supply: bigint;
  slot: number;
  epoch: number;
  now_unix: number;
  deposits_enabled: boolean;
  bootstrapped: boolean;
  legs: LegView[];
  raw_account: any; // decoded Basket account or stand-in state (for /v1/basket debugging and checks)
}

export function basketAddress(program: string, shareMint: string): string {
  return PublicKey.findProgramAddressSync([Buffer.from("basket"), new PublicKey(shareMint).toBuffer()], new PublicKey(program))[0].toBase58();
}

export async function readBasket(rpc: Rpc, cfg: BasketConfig): Promise<BasketView> {
  let address: string, program: string | null = null, shareMint: string;
  let legsCore: { mint: string; vault: string; accounted: bigint; claim_units: bigint; pending_norm: bigint; loss_index: bigint; status: any; mirror_of: string }[];
  let depositsEnabled = true, bootstrapped = true, raw: any;
  let accountsSlot = 0;
  let basketData: Buffer | null = null;

  if (cfg.source === "program") {
    if (!cfg.program || !cfg.shareMint || !cfg.idl) throw new Error("program source needs program, shareMint and idl");
    program = cfg.program;
    shareMint = cfg.shareMint;
    address = basketAddress(program, shareMint);
    const r = await rpc.account(address, "base64");
    if (!r.value) throw new Error(`basket ${address} not found on ${cfg.cluster}`);
    basketData = Buffer.from(r.value.data[0], "base64");
    raw = decodeAccount(cfg.idl, "Basket", basketData);
    legsCore = raw.legs.slice(0, raw.n_legs).map((l: any) => ({
      mint: l.mint, vault: l.vault, accounted: BigInt(l.accounted), claim_units: BigInt(l.claim_units),
      pending_norm: BigInt(l.pending_norm), loss_index: BigInt(l.loss_index), status: l.status, mirror_of: l.mirror_of,
    }));
    depositsEnabled = raw.deposits_enabled;
    bootstrapped = raw.bootstrapped;
  } else {
    raw = JSON.parse(readFileSync(cfg.standinStatePath!, "utf8"));
    address = raw.basket;
    shareMint = raw.share_mint;
    legsCore = raw.legs.map((l: any) => ({
      mint: l.mint, vault: l.vault, accounted: BigInt(l.accounted), claim_units: BigInt(l.claim_units),
      pending_norm: BigInt(l.pending_norm), loss_index: BigInt(l.loss_index), status: { kind: l.status ?? "Active" }, mirror_of: l.mirror_of,
    }));
  }

  // One read for everything that must be consistent: share mint, vaults, leg mints (+ basket again).
  const addrs = [shareMint, ...legsCore.map((l) => l.vault), ...legsCore.map((l) => l.mint)];
  if (cfg.source === "program") addrs.push(address);
  const [accs, epochInfo] = await Promise.all([rpc.accounts(addrs), rpc.epochInfo()]);
  accountsSlot = accs.slot;
  if (cfg.source === "program") {
    // Re-decode from the same read so A_i and B_i are from one slot.
    const b = accs.values[addrs.length - 1];
    const data = Buffer.from(Array.isArray(b.data) ? b.data[0] : b.data, "base64");
    raw = decodeAccount(cfg.idl, "Basket", data);
    legsCore = raw.legs.slice(0, raw.n_legs).map((l: any) => ({
      mint: l.mint, vault: l.vault, accounted: BigInt(l.accounted), claim_units: BigInt(l.claim_units),
      pending_norm: BigInt(l.pending_norm), loss_index: BigInt(l.loss_index), status: l.status, mirror_of: l.mirror_of,
    }));
  }
  const share = accs.values[0]?.data?.parsed?.info;
  if (!share) throw new Error(`share mint ${shareMint} not readable`);
  const now = Math.floor(Date.now() / 1000);
  const n = legsCore.length;

  const legs: LegView[] = legsCore.map((l, i) => {
    const vaultInfo = accs.values[1 + i]?.data?.parsed?.info ?? null;
    const mintInfo = accs.values[1 + n + i]?.data?.parsed?.info;
    if (!mintInfo) throw new Error(`leg ${i} mint ${l.mint} not readable`);
    const regLeg = cfg.registry.legs.find((x: any) => x.mint === l.mint);
    const fee = feeSchedule(mintInfo, epochInfo.epoch)!;
    const reason = availability(mintInfo, vaultInfo);
    const retired = l.status?.kind === "Retired";
    const listing = l.status?.kind === "Listing" ? { convert_after: l.status.convert_after, deadline: l.status.deadline } : null;
    const state: LegState = {
      balance: BigInt(vaultInfo?.tokenAmount?.amount ?? "0"),
      accounted: l.accounted, claim_units: l.claim_units, pending_norm: l.pending_norm, loss_index: l.loss_index,
      available: reason === null, unavailable_reason: reason, retired,
      fee_bps: fee.now_bps, maximum_fee: BigInt(fee.now_maximum_fee),
    };
    return {
      index: i,
      symbol: regLeg?.symbol ?? `LEG${i}`,
      fixture_mint: l.mint,
      mirror_of: l.mirror_of || regLeg?.mirror_of,
      vault: l.vault,
      decimals: mintInfo.decimals,
      status: retired ? "retired" : reason ? "unavailable" : listing ? "listing" : "active",
      unavailable_reason: reason,
      listing,
      fee,
      multiplier: effectiveMultiplier(mintInfo, now),
      state,
      vault_state: vaultInfo?.state ?? null,
      mint_info: mintInfo,
    };
  });

  return {
    source: cfg.source, cluster: cfg.cluster, program, basket: address, share_mint: shareMint,
    share_decimals: share.decimals, supply: BigInt(share.supply), slot: accountsSlot, epoch: epochInfo.epoch, now_unix: now,
    deposits_enabled: depositsEnabled, bootstrapped, legs, raw_account: raw,
  };
}

