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
   * Top-level instructions the route needs first, paid by the user: creation of token accounts
   * owned by the taker PDA that the route references (intermediate hops, and the taker's own
   * output account when the router lists it). Spec 02: finalize_deposit / abort_deposit close
   * them in-program and refund the rent to the owner.
   */
  preInstructions: TransactionInstruction[];
  /** Taker-owned token accounts the route needs; passed to finalize/abort as remaining accounts. */
  intermediateAccounts: PublicKey[];
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
  /** Ask the router for shared intermediate accounts (spec 02). Jupiter v2 /build currently ignores it. */
  useSharedAccounts?: boolean;
}

export interface Router {
  readonly name: string;
  route(req: SwapRequest): Promise<SwapRoute>;
}

export class RouterError extends Error {}
