// Router abstraction. `basket` CPIs whatever router is allowlisted, passing opaque data plus
// remaining accounts, and judges every swap only by the measured delta against the caller's
// min_out (spec 02, Programs). So a route here is just: program, data, accounts, lookup tables.
import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface SwapRoute {
  routerProgram: PublicKey;
  routeData: Uint8Array;
  routeAccounts: AccountMeta[];
  /** Address lookup tables with their addresses, when the router supplies them. */
  lookupTables: { key: PublicKey; addresses: PublicKey[] }[];
  inAmount: bigint;
  /** Router's quoted output (gross of the output mint's transfer fee, if the router ignores it). */
  quotedOut: bigint;
  label: string;
  source: string;
  priceImpactBps: number | null;
  /**
   * Top-level instructions the route needs first, paid by the user: creation of intermediate
   * token accounts owned by the taker PDA (multi-hop routes). They stay open after the swap
   * because only the PDA could close them (see docs/reports, packing findings).
   */
  preInstructions: TransactionInstruction[];
  /** Intermediate accounts the route leaves open (rent the user pays and does not get back). */
  leftOpenAccounts: PublicKey[];
}

export interface SwapRequest {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint;
  /** Who signs the swap inside the CPI: the ticket PDA (buy) or the basket PDA (sell). */
  taker: PublicKey;
  /** Where the output lands: the leg vault (ticket_swap_leg) or the owner's USDC account (settle_leg_usdc). */
  destination: PublicKey;
  slippageBps: number;
  /** Pays for any intermediate token accounts the route needs (the user). */
  payer?: PublicKey;
}

export interface Router {
  readonly name: string;
  route(req: SwapRequest): Promise<SwapRoute>;
}

export class RouterError extends Error {}
