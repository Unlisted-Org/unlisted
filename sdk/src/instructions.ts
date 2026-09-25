// Typed builders for every instruction in spec 02 ("Instructions").
//
// Built from spec 02 before Agent A's IDL exists. Where spec 02 is ambiguous, the choice made
// here is written next to the builder and listed in INTERFACE_ASSUMPTIONS, and
// scripts/idl-check.ts compares every name, arg and account order against
// programs/basket/idl/basket.json once it is published. Differences are reported, not adapted.
import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Writer, discriminator } from "./codec.js";
import { RedeemMode, writeRedeemMode } from "./accounts.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
} from "./constants.js";

export const INTERFACE_ASSUMPTIONS = [
  "Array args written `[T; n]` (gross, mirror_of) are Borsh Vec<T>; the program checks len == n_legs (ratified).",
  "`legs*` are Anchor remaining accounts after every named account, token programs included (ratified in spec 02 at main 7968a9f).",
  "`token programs` = token_program (classic SPL, for the share mint and USDC) then token_2022_program (legs).",
  "redeem: usdc_reserve is an Anchor Option<Account>; None is encoded as the program id (ratified).",
  "`route accounts` for ticket_swap_leg / unwind_leg / settle_leg_usdc / convert_listed_leg / reinvest_reserve are remaining accounts after the named ones, with signer flags cleared (the PDA signs inside the CPI).",
  "Instruction discriminators are Anchor's sha256('global:<snake_name>')[0..8].",
];

export interface Named { name: string; pubkey: PublicKey; writable: boolean; signer: boolean }
const acc = (name: string, pubkey: PublicKey, writable = false, signer = false): Named => ({ name, pubkey, writable, signer });

/** The instruction plus the named-account list (for idl-check and debugging). */
export interface BuiltIx { ix: TransactionInstruction; named: Named[]; remaining: AccountMeta[]; name: string }

function build(programId: PublicKey, name: string, named: Named[], args: Writer, remaining: AccountMeta[] = []): BuiltIx {
  const data = new Writer().raw(discriminator("global", name)).raw(args.build()).build();
  const keys: AccountMeta[] = [
    ...named.map((a) => ({ pubkey: a.pubkey, isWritable: a.writable, isSigner: a.signer })),
    ...remaining,
  ];
  return { ix: new TransactionInstruction({ programId, keys, data: Buffer.from(data) }), named, remaining, name };
}

/** Per-leg remaining accounts for legs*: (mint, vault[w], user_token_account[w]). */
export interface LegAccounts { mint: PublicKey; vault: PublicKey; userTokenAccount?: PublicKey }
export function legsRemaining(legs: LegAccounts[], withUser: boolean): AccountMeta[] {
  const out: AccountMeta[] = [];
  for (const l of legs) {
    out.push({ pubkey: l.mint, isWritable: false, isSigner: false });
    out.push({ pubkey: l.vault, isWritable: true, isSigner: false });
    if (withUser) {
      if (!l.userTokenAccount) throw new Error("user token account required for this leg");
      out.push({ pubkey: l.userTokenAccount, isWritable: true, isSigner: false });
    }
  }
  return out;
}

function intermediatesRemaining(xs: PublicKey[] = []): AccountMeta[] {
  return xs.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false }));
}

/** Route accounts from a router, passed through as remaining accounts. PDAs can't sign at top level. */
export function routeRemaining(metas: AccountMeta[]): AccountMeta[] {
  return metas.map((m) => ({ pubkey: m.pubkey, isWritable: m.isWritable, isSigner: false }));
}

// ---------------- Setup and authority ----------------

export function initializeBasket(p: {
  programId: PublicKey; payer: PublicKey; authority: PublicKey; basket: PublicKey; shareMint: PublicKey;
  usdcMint: PublicKey; usdcReserve: PublicKey; legs: { mint: PublicKey; vault: PublicKey }[];
  mirrorOf: PublicKey[]; maxConvertChunk: bigint;
  /** IDL c141837 adds `routers: Vec<Pubkey>`, not in spec 02 (docs/reports/2026-09-25-app-idl-diff.md #1). */
  routers: PublicKey[];
}): BuiltIx {
  const named = [
    acc("payer", p.payer, true, true), acc("authority", p.authority, false, true), acc("basket", p.basket, true),
    acc("share_mint", p.shareMint, true), acc("usdc_mint", p.usdcMint), acc("usdc_reserve", p.usdcReserve, true),
  ];
  const tail = [
    acc("token_program", TOKEN_PROGRAM_ID), acc("token_2022_program", TOKEN_2022_PROGRAM_ID),
    acc("associated_token_program", ASSOCIATED_TOKEN_PROGRAM_ID), acc("system_program", SYSTEM_PROGRAM_ID),
  ];
  const w = new Writer().u8(p.legs.length);
  w.vec(p.mirrorOf, (k) => w.pubkey(k)).u64(p.maxConvertChunk);
  w.vec(p.routers, (k) => w.pubkey(k));
  return build(p.programId, "initialize_basket", [...named, ...tail], w, legsRemaining(p.legs, false));
}

export function proposeRouter(p: { programId: PublicKey; authority: PublicKey; basket: PublicKey; router: PublicKey }): BuiltIx {
  return build(p.programId, "propose_router", [acc("authority", p.authority, false, true), acc("basket", p.basket, true)], new Writer().pubkey(p.router));
}
export function activateRouter(p: { programId: PublicKey; authority: PublicKey; basket: PublicKey; router: PublicKey }): BuiltIx {
  return build(p.programId, "activate_router", [acc("authority", p.authority, false, true), acc("basket", p.basket, true)], new Writer().pubkey(p.router));
}
/** IDL c141837 only; not in spec 02 (docs/reports/2026-09-25-app-idl-diff.md #7). */
export function removeRouter(p: { programId: PublicKey; authority: PublicKey; basket: PublicKey; router: PublicKey }): BuiltIx {
  return build(p.programId, "remove_router", [acc("authority", p.authority, false, true), acc("basket", p.basket, true)], new Writer().pubkey(p.router));
}

export function setDepositsEnabled(p: { programId: PublicKey; authority: PublicKey; basket: PublicKey; enabled: boolean }): BuiltIx {
  return build(p.programId, "set_deposits_enabled", [acc("authority", p.authority, false, true), acc("basket", p.basket, true)], new Writer().bool(p.enabled));
}
export function flagListing(p: { programId: PublicKey; authority: PublicKey; basket: PublicKey; leg: number; convertAfter: bigint; deadline: bigint }): BuiltIx {
  return build(p.programId, "flag_listing", [acc("authority", p.authority, false, true), acc("basket", p.basket, true)],
    new Writer().u8(p.leg).i64(p.convertAfter).i64(p.deadline));
}
export function cancelListing(p: { programId: PublicKey; authority: PublicKey; basket: PublicKey; leg: number }): BuiltIx {
  return build(p.programId, "cancel_listing", [acc("authority", p.authority, false, true), acc("basket", p.basket, true)], new Writer().u8(p.leg));
}

// ---------------- Mint ----------------

function tokenPrograms(): Named[] {
  return [acc("token_program", TOKEN_PROGRAM_ID), acc("token_2022_program", TOKEN_2022_PROGRAM_ID)];
}

export function bootstrap(p: {
  programId: PublicKey; depositor: PublicKey; basket: PublicKey; shareMint: PublicKey; depositorShareAta: PublicKey;
  legs: LegAccounts[]; gross: bigint[];
}): BuiltIx {
  const named = [acc("depositor", p.depositor, true, true), acc("basket", p.basket, true), acc("share_mint", p.shareMint, true),
    acc("depositor_share_ata", p.depositorShareAta, true), ...tokenPrograms()];
  const w = new Writer();
  w.vec(p.gross, (g) => w.u64(g));
  return build(p.programId, "bootstrap", named, w, legsRemaining(p.legs, true));
}

export function depositInKind(p: {
  programId: PublicKey; depositor: PublicKey; basket: PublicKey; shareMint: PublicKey; depositorShareAta: PublicKey;
  legs: LegAccounts[]; gross: bigint[]; minShares: bigint;
}): BuiltIx {
  const named = [acc("depositor", p.depositor, true, true), acc("basket", p.basket, true), acc("share_mint", p.shareMint, true),
    acc("depositor_share_ata", p.depositorShareAta, true), ...tokenPrograms()];
  const w = new Writer();
  w.vec(p.gross, (g) => w.u64(g)).u64(p.minShares);
  return build(p.programId, "deposit_in_kind", named, w, legsRemaining(p.legs, true));
}

export function openDepositTicket(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; ticket: PublicKey; escrow: PublicKey; ownerUsdc: PublicKey;
  usdcMint: PublicKey; nonce: bigint; usdcIn: bigint; expirySlots: bigint;
  /** Program c141837 reads (mint, vault)×n as remaining accounts for the availability check (docs/reports/2026-09-25-app-idl-diff.md #8). */
  legs: { mint: PublicKey; vault: PublicKey }[];
}): BuiltIx {
  const named = [acc("owner", p.owner, true, true), acc("basket", p.basket), acc("ticket", p.ticket, true), acc("escrow", p.escrow, true),
    acc("owner_usdc", p.ownerUsdc, true), acc("usdc_mint", p.usdcMint), acc("token_program", TOKEN_PROGRAM_ID),
    acc("associated_token_program", ASSOCIATED_TOKEN_PROGRAM_ID), acc("system_program", SYSTEM_PROGRAM_ID)];
  return build(p.programId, "open_deposit_ticket", named, new Writer().u64(p.nonce).u64(p.usdcIn).u64(p.expirySlots), legsRemaining(p.legs, false));
}

export function ticketSwapLeg(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; ticket: PublicKey; escrow: PublicKey; legMint: PublicKey; legVault: PublicKey;
  routerProgram: PublicKey; routeAccounts: AccountMeta[]; leg: number; usdcAmount: bigint; minOut: bigint; routeData: Uint8Array;
}): BuiltIx {
  const named = [acc("owner", p.owner, false, true), acc("basket", p.basket, true), acc("ticket", p.ticket, true), acc("escrow", p.escrow, true),
    acc("leg_mint", p.legMint), acc("leg_vault", p.legVault, true), acc("router_program", p.routerProgram)];
  const w = new Writer().u8(p.leg).u64(p.usdcAmount).u64(p.minOut).bytesVec(p.routeData);
  return build(p.programId, "ticket_swap_leg", named, w, routeRemaining(p.routeAccounts));
}

export function finalizeDeposit(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; ticket: PublicKey; escrow: PublicKey; ownerUsdc: PublicKey;
  shareMint: PublicKey; ownerShareAta: PublicKey; legs: LegAccounts[]; minShares: bigint; intermediates?: PublicKey[];
}): BuiltIx {
  const named = [acc("owner", p.owner, true, true), acc("basket", p.basket, true), acc("ticket", p.ticket, true), acc("escrow", p.escrow, true),
    acc("owner_usdc", p.ownerUsdc, true), acc("share_mint", p.shareMint, true), acc("owner_share_ata", p.ownerShareAta, true),
    ...tokenPrograms()];
  // Remaining: (mint, vault)×n, then every ticket-owned intermediate token account to close (spec 02).
  return build(p.programId, "finalize_deposit", named, new Writer().u64(p.minShares),
    [...legsRemaining(p.legs, false), ...intermediatesRemaining(p.intermediates)]);
}

export function unwindLeg(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; ticket: PublicKey; escrow: PublicKey; legMint: PublicKey; legVault: PublicKey;
  routerProgram: PublicKey; routeAccounts: AccountMeta[]; leg: number; minUsdcOut: bigint; routeData: Uint8Array;
}): BuiltIx {
  const named = [acc("owner", p.owner, false, true), acc("basket", p.basket, true), acc("ticket", p.ticket, true), acc("escrow", p.escrow, true),
    acc("leg_mint", p.legMint), acc("leg_vault", p.legVault, true), acc("router_program", p.routerProgram)];
  return build(p.programId, "unwind_leg", named, new Writer().u8(p.leg).u64(p.minUsdcOut).bytesVec(p.routeData), routeRemaining(p.routeAccounts));
}

export function abortDeposit(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; ticket: PublicKey; escrow: PublicKey; ownerUsdc: PublicKey; intermediates?: PublicKey[];
}): BuiltIx {
  // Spec 02 lists owner, basket, ticket, escrow, owner_usdc; IDL c141837 adds both token programs (docs/reports/2026-09-25-app-idl-diff.md #3).
  const named = [acc("owner", p.owner, true, true), acc("basket", p.basket), acc("ticket", p.ticket, true), acc("escrow", p.escrow, true),
    acc("owner_usdc", p.ownerUsdc, true), ...tokenPrograms()];
  return build(p.programId, "abort_deposit", named, new Writer(), intermediatesRemaining(p.intermediates));
}

// ---------------- Redeem ----------------

export function redeem(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; shareMint: PublicKey; ownerShareAta: PublicKey; ticket: PublicKey;
  usdcReserve: PublicKey | null; legs: LegAccounts[]; nonce: bigint; shares: bigint; mode: RedeemMode;
  /** IDL c141837 adds optional `owner_usdc` after usdc_reserve (docs/reports/2026-09-25-app-idl-diff.md #4). */
  ownerUsdc?: PublicKey | null;
}): BuiltIx {
  const named = [acc("owner", p.owner, true, true), acc("basket", p.basket, true), acc("share_mint", p.shareMint, true),
    acc("owner_share_ata", p.ownerShareAta, true), acc("ticket", p.ticket, true),
    p.usdcReserve ? acc("usdc_reserve", p.usdcReserve, true) : acc("usdc_reserve", p.programId),
    p.ownerUsdc ? acc("owner_usdc", p.ownerUsdc, true) : acc("owner_usdc", p.programId),
    ...tokenPrograms(), acc("system_program", SYSTEM_PROGRAM_ID)];
  const w = new Writer().u64(p.nonce).u64(p.shares);
  writeRedeemMode(w, p.mode);
  return build(p.programId, "redeem", named, w, legsRemaining(p.legs, p.legs.every((l) => !!l.userTokenAccount)));
}

export function settleClaim(p: {
  programId: PublicKey; cranker: PublicKey; basket: PublicKey; ticket: PublicKey; legMint: PublicKey; legVault: PublicKey;
  ownerTokenAccount: PublicKey; leg: number;
  /** IDL c141837 adds `share_mint` last (docs/reports/2026-09-25-app-idl-diff.md #5). */
  shareMint: PublicKey;
}): BuiltIx {
  const named = [acc("cranker", p.cranker, true, true), acc("basket", p.basket, true), acc("ticket", p.ticket, true),
    acc("leg_mint", p.legMint), acc("leg_vault", p.legVault, true), acc("owner_token_account", p.ownerTokenAccount, true),
    acc("token_2022_program", TOKEN_2022_PROGRAM_ID), acc("share_mint", p.shareMint)];
  return build(p.programId, "settle_claim", named, new Writer().u8(p.leg));
}

export function settleLegUsdc(p: {
  programId: PublicKey; owner: PublicKey; basket: PublicKey; ticket: PublicKey; legMint: PublicKey; legVault: PublicKey;
  ownerUsdc: PublicKey; routerProgram: PublicKey; routeAccounts: AccountMeta[]; leg: number; minUsdcOut: bigint; routeData: Uint8Array;
  /** IDL c141837 adds `share_mint` last (docs/reports/2026-09-25-app-idl-diff.md #6). */
  shareMint: PublicKey;
}): BuiltIx {
  const named = [acc("owner", p.owner, false, true), acc("basket", p.basket, true), acc("ticket", p.ticket, true),
    acc("leg_mint", p.legMint), acc("leg_vault", p.legVault, true), acc("owner_usdc", p.ownerUsdc, true), acc("router_program", p.routerProgram),
    acc("share_mint", p.shareMint)];
  return build(p.programId, "settle_leg_usdc", named, new Writer().u8(p.leg).u64(p.minUsdcOut).bytesVec(p.routeData), routeRemaining(p.routeAccounts));
}

export function closeRedemption(p: { programId: PublicKey; owner: PublicKey; ticket: PublicKey }): BuiltIx {
  return build(p.programId, "close_redemption", [acc("owner", p.owner, true, true), acc("ticket", p.ticket, true)], new Writer());
}

// ---------------- Maintenance (permissionless) ----------------
// Account lists from spec 02 (main 7968a9f).

export function observeIx(p: { programId: PublicKey; cranker: PublicKey; basket: PublicKey; legs: { mint: PublicKey; vault: PublicKey }[]; mask: number }): BuiltIx {
  // Remaining: (mint, vault) for each leg in the mask, in leg order. `legs` is the full leg list.
  const inMask = p.legs.filter((_, i) => (p.mask >> i) & 1);
  return build(p.programId, "observe", [acc("cranker", p.cranker, true, true), acc("basket", p.basket, true)], new Writer().u8(p.mask), legsRemaining(inMask, false));
}

export function harvest(p: { programId: PublicKey; cranker: PublicKey; basket: PublicKey; legMint: PublicKey; legVault: PublicKey; leg: number }): BuiltIx {
  return build(p.programId, "harvest", [acc("cranker", p.cranker, true, true), acc("basket", p.basket), acc("leg_mint", p.legMint, true),
    acc("leg_vault", p.legVault, true), acc("token_2022_program", TOKEN_2022_PROGRAM_ID)], new Writer().u8(p.leg));
}

export function convertListedLeg(p: {
  programId: PublicKey; cranker: PublicKey; basket: PublicKey; legMint: PublicKey; legVault: PublicKey; usdcMint: PublicKey; usdcReserve: PublicKey;
  routerProgram: PublicKey; routeAccounts: AccountMeta[]; leg: number; amount: bigint; minUsdcOut: bigint; routeData: Uint8Array;
}): BuiltIx {
  const named = [acc("cranker", p.cranker, true, true), acc("basket", p.basket, true), acc("leg_mint", p.legMint), acc("leg_vault", p.legVault, true),
    acc("usdc_mint", p.usdcMint), acc("usdc_reserve", p.usdcReserve, true), acc("router_program", p.routerProgram)];
  return build(p.programId, "convert_listed_leg", named, new Writer().u8(p.leg).u64(p.amount).u64(p.minUsdcOut).bytesVec(p.routeData),
    routeRemaining(p.routeAccounts));
}

export function reinvestReserve(p: {
  programId: PublicKey; cranker: PublicKey; basket: PublicKey; usdcMint: PublicKey; usdcReserve: PublicKey; legMint: PublicKey; legVault: PublicKey;
  routerProgram: PublicKey; routeAccounts: AccountMeta[]; leg: number; usdcAmount: bigint; minOut: bigint; routeData: Uint8Array;
}): BuiltIx {
  const named = [acc("cranker", p.cranker, true, true), acc("basket", p.basket, true), acc("usdc_mint", p.usdcMint), acc("usdc_reserve", p.usdcReserve, true),
    acc("leg_mint", p.legMint), acc("leg_vault", p.legVault, true), acc("router_program", p.routerProgram)];
  return build(p.programId, "reinvest_reserve", named, new Writer().u8(p.leg).u64(p.usdcAmount).u64(p.minOut).bytesVec(p.routeData),
    routeRemaining(p.routeAccounts));
}

/** Every instruction name in spec 02, for idl-check. */
export const SPEC_INSTRUCTIONS = [
  "initialize_basket", "propose_router", "activate_router", "set_deposits_enabled", "flag_listing", "cancel_listing",
  "bootstrap", "deposit_in_kind", "open_deposit_ticket", "ticket_swap_leg", "finalize_deposit", "unwind_leg", "abort_deposit",
  "redeem", "settle_claim", "settle_leg_usdc", "close_redemption",
  "observe", "harvest", "convert_listed_leg", "reinvest_reserve",
] as const;
