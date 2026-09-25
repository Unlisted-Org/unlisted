// User flows → unsigned transactions. The app hands every transaction of a flow to the wallet in
// ONE signing call (Wallet Standard solana:signTransaction with several inputs, or
// signAllTransactions), then sends them in order with sendSequential.
import { AccountMeta, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { BasketView, legStates } from "./client.js";
import { BPS, LEGS_PER_SWAP_TX, TICKET_MAX_AGE_SLOTS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";
import * as ix from "./instructions.js";
import { DepositTicket, RedeemMode } from "./accounts.js";
import { mintInKind, netDeltasForShares, observe, pendingActual, redeemInKind, RedeemLegOutcome, sharesForDeltas } from "./math.js";
import { ata, depositTicketPda, freshNonce, redemptionTicketPda, ticketEscrow } from "./pda.js";
import { grossForNet, transferFee } from "./token2022.js";
import { Router, SwapRoute } from "./routers/types.js";
import { Lut, Packed, computeBudget, tryCompile, measure } from "./tx.js";

const applySlippage = (x: bigint, bps: number) => (x * (BPS - BigInt(bps))) / BPS;

function basketLut(v: BasketView): Lut[] {
  return v.lut ? [v.lut] : [];
}

// ---------------- In-kind deposit ----------------

export interface InKindPlan {
  shares: bigint; // shares the gross amounts mint at the state read
  minShares: bigint;
  gross: bigint[];
  netDeltas: bigint[];
  fees: bigint[]; // what Token-2022 withholds on the way in, per leg
  txs: VersionedTransaction[];
}

/** Size an in-kind deposit to the current per-share composition for `targetShares`. */
export function planInKindDeposit(v: BasketView, owner: PublicKey, targetShares: bigint, slippageBps: number, blockhash: string): InKindPlan {
  if (v.legs.some((l) => l.unavailable.length)) throw new Error("LegUnavailable: deposits are refused while any leg is unavailable");
  const states = legStates(v);
  const net = netDeltasForShares(states, v.shareSupply, targetShares);
  const gross = net.map((n, i) => grossForNet(n, v.legs[i].feeNow));
  const sim = mintInKind(states, v.shareSupply, gross, v.legs.map((l) => l.feeNow));
  const minShares = applySlippage(sim.shares, slippageBps);
  const programId = v.config.programId;
  const shareAta = ata(owner, v.basket.shareMint, TOKEN_PROGRAM_ID);
  const ixs: TransactionInstruction[] = [
    ...computeBudget(400_000),
    createAssociatedTokenAccountIdempotentInstruction(owner, shareAta, owner, v.basket.shareMint, TOKEN_PROGRAM_ID),
    ix.depositInKind({
      programId, depositor: owner, basket: v.address, shareMint: v.basket.shareMint, depositorShareAta: shareAta,
      legs: v.legs.map((l) => ({ mint: l.mint, vault: l.vault, userTokenAccount: ata(owner, l.mint, TOKEN_2022_PROGRAM_ID) })),
      gross, minShares,
    }).ix,
  ];
  const packed = tryCompile(owner, blockhash, ixs, basketLut(v));
  if (!packed) throw new Error(`in-kind deposit does not fit one transaction: ${JSON.stringify(measure(owner, blockhash, ixs, basketLut(v)))}`);
  return { shares: sim.shares, minShares, gross, netDeltas: sim.deltas, fees: gross.map((g, i) => transferFee(g, v.legs[i].feeNow)), txs: [packed.tx] };
}

// ---------------- USDC deposit ticket ----------------

export interface TicketLegPlan { leg: number; usdc: bigint; route: SwapRoute; minOut: bigint }
export interface UsdcDepositPlan {
  nonce: bigint;
  ticket: PublicKey;
  escrow: PublicKey;
  usdcIn: bigint;
  legs: TicketLegPlan[];
  txs: VersionedTransaction[];
  packing: { legs: number[]; bytes: number; accounts: number; hasOpen: boolean; hasFinalize: boolean }[];
  minShares: bigint;
  /** Shares the quoted outputs would mint at the state read (before slippage). */
  expectedShares: bigint;
}

/**
 * Plan a USDC deposit ticket: open_deposit_ticket, one ticket_swap_leg per leg (output straight
 * into the leg vault), finalize_deposit. Packed greedily, at most LEGS_PER_SWAP_TX swaps per
 * transaction, each checked against the 1,232-byte and 64-account limits.
 *
 * `split[i]` is the USDC for leg i (from /v1/quote/deposit, proportional to one share's per-leg
 * sell_now value). min_shares defaults to the mint formula on each leg's min_out.
 */
export async function planUsdcDeposit(p: {
  v: BasketView; owner: PublicKey; usdcIn: bigint; split: bigint[]; router: Router; slippageBps: number; blockhash: string;
  minShares?: bigint; nonce?: bigint; expirySlots?: number; legsPerTx?: number;
}): Promise<UsdcDepositPlan> {
  const { v, owner } = p;
  if (v.legs.some((l) => l.unavailable.length)) throw new Error("LegUnavailable: deposits are refused while any leg is unavailable");
  if (!v.basket.depositsEnabled) throw new Error("DepositsDisabled");
  const total = p.split.reduce((a, b) => a + b, 0n);
  if (total > p.usdcIn) throw new Error("split exceeds usdc_in");
  const programId = v.config.programId;
  const nonce = p.nonce ?? freshNonce();
  const [ticket] = depositTicketPda(programId, v.address, owner, nonce);
  const escrow = ticketEscrow(ticket, v.basket.usdcMint);
  const ownerUsdc = ata(owner, v.basket.usdcMint, v.usdcMintProgram);
  const shareAta = ata(owner, v.basket.shareMint, TOKEN_PROGRAM_ID);

  const legs: TicketLegPlan[] = [];
  for (const l of v.legs) {
    const usdc = p.split[l.index];
    const route = await p.router.route({
      inputMint: v.basket.usdcMint, outputMint: l.mint, amount: usdc, taker: ticket, destination: l.vault, slippageBps: p.slippageBps, payer: owner,
    });
    legs.push({ leg: l.index, usdc, route, minOut: applySlippage(route.quotedOut, p.slippageBps) });
  }

  // Shares: the mint formula on the deltas. Expected uses the quotes; the floor uses each leg's
  // min_out, which the program enforces per leg, so min_shares can't bind before a min_out does.
  const observed = legStates(v).map((l) => observe(l).leg);
  const expectedShares = sharesForDeltas(observed, v.shareSupply, legs.map((t) => t.route.quotedOut));
  const minShares = p.minShares ?? sharesForDeltas(observed, v.shareSupply, legs.map((t) => t.minOut));
  const openIx = ix.openDepositTicket({
    programId, owner, basket: v.address, ticket, escrow, ownerUsdc, usdcMint: v.basket.usdcMint, nonce, usdcIn: p.usdcIn,
    expirySlots: BigInt(p.expirySlots ?? TICKET_MAX_AGE_SLOTS), legs: v.legs.map((l) => ({ mint: l.mint, vault: l.vault })),
  }).ix;
  const swapIxs = legs.map((t) => [...t.route.preInstructions, ix.ticketSwapLeg({
    programId, owner, basket: v.address, ticket, escrow, legMint: v.legs[t.leg].mint, legVault: v.legs[t.leg].vault,
    routerProgram: t.route.routerProgram, routeAccounts: t.route.routeAccounts, leg: t.leg, usdcAmount: t.usdc, minOut: t.minOut,
    routeData: t.route.routeData,
  }).ix]);
  const finalizeIxs = [
    createAssociatedTokenAccountIdempotentInstruction(owner, shareAta, owner, v.basket.shareMint, TOKEN_PROGRAM_ID),
    ix.finalizeDeposit({
      programId, owner, basket: v.address, ticket, escrow, ownerUsdc, shareMint: v.basket.shareMint, ownerShareAta: shareAta,
      legs: v.legs.map((l) => ({ mint: l.mint, vault: l.vault })), minShares,
      intermediates: legs.flatMap((t) => t.route.intermediateAccounts),
    }).ix,
  ];
  const luts = [...basketLut(v), ...legs.flatMap((t) => t.route.lookupTables)];
  const packed = packTicket(owner, p.blockhash, openIx, swapIxs, finalizeIxs, luts, p.legsPerTx ?? LEGS_PER_SWAP_TX);
  return {
    nonce, ticket, escrow, usdcIn: p.usdcIn, legs, minShares, expectedShares,
    txs: packed.map((x) => x.packed.tx),
    packing: packed.map((x) => ({ legs: x.legs, bytes: x.packed.bytes, accounts: x.packed.accounts, hasOpen: x.hasOpen, hasFinalize: x.hasFinalize })),
  };
}

/** Greedy packer. Exposed for the packing measurement script (mainnet routes, nothing signed). */
export function packTicket(
  payer: PublicKey, blockhash: string, openIx: TransactionInstruction, swapIxs: TransactionInstruction[][], finalizeIxs: TransactionInstruction[],
  luts: Lut[], legsPerTx: number,
): { packed: Packed; legs: number[]; hasOpen: boolean; hasFinalize: boolean }[] {
  const out: { packed: Packed; legs: number[]; hasOpen: boolean; hasFinalize: boolean }[] = [];
  let cur: TransactionInstruction[] = [...computeBudget(), openIx];
  let curLegs: number[] = [];
  let hasOpen = true;
  let last: Packed | null = tryCompile(payer, blockhash, cur, luts);
  if (!last) throw new Error("open_deposit_ticket alone does not fit");
  const flush = () => {
    out.push({ packed: last!, legs: curLegs, hasOpen, hasFinalize: false });
    cur = [...computeBudget()];
    curLegs = [];
    hasOpen = false;
    last = null;
  };
  swapIxs.forEach((s, i) => {
    if (curLegs.length < legsPerTx) {
      const tryIt = tryCompile(payer, blockhash, [...cur, ...s], luts);
      if (tryIt) { cur.push(...s); curLegs.push(i); last = tryIt; return; }
    }
    if (curLegs.length === 0 && !hasOpen) {
      throw new Error(`leg ${i} swap alone does not fit a transaction: ${JSON.stringify(measure(payer, blockhash, [...cur, ...s], luts))}`);
    }
    flush();
    const alone = tryCompile(payer, blockhash, [...cur, ...s], luts);
    if (!alone) throw new Error(`leg ${i} swap alone does not fit a transaction: ${JSON.stringify(measure(payer, blockhash, [...cur, ...s], luts))}`);
    cur.push(...s); curLegs.push(i); last = alone;
  });
  const withFin = tryCompile(payer, blockhash, [...cur, ...finalizeIxs], luts);
  if (withFin) {
    out.push({ packed: withFin, legs: curLegs, hasOpen, hasFinalize: true });
  } else {
    flush();
    const fin = tryCompile(payer, blockhash, [...computeBudget(), ...finalizeIxs], luts);
    if (!fin) throw new Error("finalize_deposit does not fit");
    out.push({ packed: fin, legs: [], hasOpen: false, hasFinalize: true });
  }
  return out;
}

// ---------------- Redeem ----------------

export interface RedeemPlan {
  nonce: bigint;
  ticket: PublicKey;
  outcomes: RedeemLegOutcome[];
  txs: VersionedTransaction[];
}

/**
 * Redeem `shares`. InKind pays available legs now and turns unavailable legs into claims; Usdc
 * turns every leg into a PendingSale claim settled by settle_leg_usdc. If the owner lacks leg
 * token accounts, a first transaction creates them (both go to the wallet in one approval).
 */
export async function planRedeem(p: {
  v: BasketView; owner: PublicKey; shares: bigint; mode: RedeemMode; blockhash: string; existingLegAtas: boolean[]; nonce?: bigint;
}): Promise<RedeemPlan> {
  const { v, owner } = p;
  const programId = v.config.programId;
  const nonce = p.nonce ?? freshNonce();
  const [ticket] = redemptionTicketPda(programId, v.address, owner, nonce);
  const outcomes = redeemInKind(legStates(v), v.shareSupply, p.shares, v.legs.map((l) => l.feeNow));
  const legAtas = v.legs.map((l) => ata(owner, l.mint, TOKEN_2022_PROGRAM_ID));
  const txs: VersionedTransaction[] = [];
  const missing = v.legs.filter((_, i) => !p.existingLegAtas[i]);
  if (missing.length) {
    const create = missing.map((l) => createAssociatedTokenAccountIdempotentInstruction(owner, legAtas[l.index], owner, l.mint, TOKEN_2022_PROGRAM_ID));
    // Split so each transaction fits.
    let batch: TransactionInstruction[] = [];
    for (const c of create) {
      if (tryCompile(owner, p.blockhash, [...batch, c], [])) batch.push(c);
      else { txs.push(tryCompile(owner, p.blockhash, batch, [])!.tx); batch = [c]; }
    }
    if (batch.length) txs.push(tryCompile(owner, p.blockhash, batch, [])!.tx);
  }
  const redeemIx = ix.redeem({
    programId, owner, basket: v.address, shareMint: v.basket.shareMint, ownerShareAta: ata(owner, v.basket.shareMint, TOKEN_PROGRAM_ID),
    ticket, usdcReserve: v.basket.accountedUsdcReserve > 0n ? v.basket.usdcReserve : null,
    ownerUsdc: v.basket.accountedUsdcReserve > 0n ? ata(owner, v.basket.usdcMint, v.usdcMintProgram) : null,
    legs: v.legs.map((l, i) => ({ mint: l.mint, vault: l.vault, userTokenAccount: legAtas[i] })),
    nonce, shares: p.shares, mode: p.mode,
  }).ix;
  const packed = tryCompile(owner, p.blockhash, [...computeBudget(600_000), redeemIx], basketLut(v));
  if (!packed) throw new Error(`redeem does not fit one transaction: ${JSON.stringify(measure(owner, p.blockhash, [redeemIx], []))}`);
  txs.push(packed.tx);
  return { nonce, ticket, outcomes, txs };
}

/** settle_claim for one claim leg (permissionless; the cranker pays the fee). */
export function planSettleClaim(p: { v: BasketView; cranker: PublicKey; ticket: PublicKey; owner: PublicKey; leg: number; blockhash: string }): VersionedTransaction {
  const l = p.v.legs[p.leg];
  const ownerAta = ata(p.owner, l.mint, TOKEN_2022_PROGRAM_ID);
  const ixs = [
    ...computeBudget(300_000),
    createAssociatedTokenAccountIdempotentInstruction(p.cranker, ownerAta, p.owner, l.mint, TOKEN_2022_PROGRAM_ID),
    ix.settleClaim({ programId: p.v.config.programId, cranker: p.cranker, basket: p.v.address, ticket: p.ticket, legMint: l.mint, legVault: l.vault,
      ownerTokenAccount: ownerAta, leg: p.leg, shareMint: p.v.basket.shareMint }).ix,
  ];
  const packed = tryCompile(p.cranker, p.blockhash, ixs, []);
  if (!packed) throw new Error("settle_claim does not fit");
  return packed.tx;
}

/** settle_leg_usdc: sell a claim's leg through the router, the basket PDA as taker, USDC to the owner. */
export async function planSettleLegUsdc(p: {
  v: BasketView; owner: PublicKey; ticket: PublicKey; leg: number; sellAmount: bigint; router: Router; slippageBps: number; blockhash: string;
}): Promise<{ tx: VersionedTransaction; route: SwapRoute; minUsdcOut: bigint }> {
  const l = p.v.legs[p.leg];
  const ownerUsdc = ata(p.owner, p.v.basket.usdcMint, p.v.usdcMintProgram);
  const route = await p.router.route({ inputMint: l.mint, outputMint: p.v.basket.usdcMint, amount: p.sellAmount, taker: p.v.address, destination: ownerUsdc, slippageBps: p.slippageBps,
    payer: p.owner, existingAccounts: [p.v.basket.usdcReserve] });
  const minUsdcOut = applySlippage(route.quotedOut, p.slippageBps);
  const ixs = [
    ...computeBudget(),
    createAssociatedTokenAccountIdempotentInstruction(p.owner, ownerUsdc, p.owner, p.v.basket.usdcMint, p.v.usdcMintProgram),
    ix.settleLegUsdc({ programId: p.v.config.programId, owner: p.owner, basket: p.v.address, ticket: p.ticket, legMint: l.mint, legVault: l.vault,
      ownerUsdc, routerProgram: route.routerProgram, routeAccounts: route.routeAccounts, leg: p.leg, minUsdcOut, routeData: route.routeData,
      shareMint: p.v.basket.shareMint }).ix,
  ];
  const packed = tryCompile(p.owner, p.blockhash, ixs, route.lookupTables);
  if (!packed) throw new Error("settle_leg_usdc does not fit");
  return { tx: packed.tx, route, minUsdcOut };
}

export function planCloseRedemption(p: { v: BasketView; owner: PublicKey; ticket: PublicKey; blockhash: string }): VersionedTransaction {
  const packed = tryCompile(p.owner, p.blockhash, [ix.closeRedemption({ programId: p.v.config.programId, owner: p.owner, ticket: p.ticket }).ix], []);
  return packed!.tx;
}

export type { AccountMeta };

/** Permissionless observe on the legs in `mask`: records any shortfall on chain now (spec 01). */
export function planObserve(p: { v: BasketView; cranker: PublicKey; mask: number; blockhash: string }): VersionedTransaction {
  const packed = tryCompile(p.cranker, p.blockhash, [...computeBudget(200_000),
    ix.observeIx({ programId: p.v.config.programId, cranker: p.cranker, basket: p.v.address, legs: p.v.legs.map((l) => ({ mint: l.mint, vault: l.vault })), mask: p.mask }).ix], []);
  if (!packed) throw new Error("observe does not fit");
  return packed.tx;
}


export interface AbortPlan { txs: VersionedTransaction[]; unwound: { leg: number; amount: bigint; quotedUsdc: bigint; minUsdcOut: bigint }[]; closes: PublicKey[] }

/**
 * Abort an open deposit ticket: unwind every landed leg (sell the ticket's landed amount from the
 * vault back into the escrow; the basket PDA is the taker), then abort_deposit, which refunds the
 * escrow and closes the ticket. `ticketOwned` must be every token account the ticket PDA owns
 * (BasketClient.ticketOwnedTokenAccounts): the program closes only those it is given.
 */
export async function planAbortDeposit(p: {
  v: BasketView; owner: PublicKey; ticket: PublicKey; t: DepositTicket; ticketOwned: PublicKey[]; router: Router | null; slippageBps: number; blockhash: string;
}): Promise<AbortPlan> {
  const { v, owner, t } = p;
  const programId = v.config.programId;
  const ownerUsdc = ata(owner, v.basket.usdcMint, v.usdcMintProgram);
  const txs: VersionedTransaction[] = [];
  const unwound: AbortPlan["unwound"] = [];
  for (const l of v.legs) {
    if (!(t.landedMask & (1 << l.index))) continue;
    if (!p.router) throw new Error(`${l.symbol} landed: unwinding it needs a router`);
    const leg = observe(l.state).leg; // the program observes before computing the amount
    const amount = pendingActual({ ...leg, pendingNorm: t.norm[l.index] });
    const route = await p.router.route({ inputMint: l.mint, outputMint: v.basket.usdcMint, amount, taker: v.address, destination: t.escrow,
      slippageBps: p.slippageBps, payer: owner, existingAccounts: [v.basket.usdcReserve] });
    const minUsdcOut = applySlippage(route.quotedOut, p.slippageBps);
    const packed = tryCompile(owner, p.blockhash, [...computeBudget(), ...route.preInstructions, ix.unwindLeg({
      programId, owner, basket: v.address, ticket: p.ticket, escrow: t.escrow, legMint: l.mint, legVault: l.vault,
      routerProgram: route.routerProgram, routeAccounts: route.routeAccounts, leg: l.index, minUsdcOut, routeData: route.routeData,
    }).ix], route.lookupTables);
    if (!packed) throw new Error(`unwind_leg ${l.symbol} does not fit`);
    txs.push(packed.tx);
    unwound.push({ leg: l.index, amount, quotedUsdc: route.quotedOut, minUsdcOut });
  }
  // The escrow is a named account; every other ticket-owned account goes in the remaining list.
  const closes = p.ticketOwned.filter((k) => !k.equals(t.escrow));
  const packed = tryCompile(owner, p.blockhash, [...computeBudget(),
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerUsdc, owner, v.basket.usdcMint, v.usdcMintProgram),
    ix.abortDeposit({ programId, owner, basket: v.address, ticket: p.ticket, escrow: t.escrow, ownerUsdc, intermediates: closes }).ix], []);
  if (!packed) throw new Error("abort_deposit does not fit");
  txs.push(packed.tx);
  return { txs, unwound, closes };
}
