// PDA seeds from spec 02 (Accounts).
import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";
import { toLeU64 } from "./codec.js";

const enc = (s: string) => new TextEncoder().encode(s);

export function basketPda(programId: PublicKey, shareMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc("basket"), shareMint.toBytes()], programId);
}

export function depositTicketPda(programId: PublicKey, basket: PublicKey, owner: PublicKey, nonce: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc("deposit"), basket.toBytes(), owner.toBytes(), toLeU64(nonce)], programId);
}

export function redemptionTicketPda(programId: PublicKey, basket: PublicKey, owner: PublicKey, nonce: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc("redeem"), basket.toBytes(), owner.toBytes(), toLeU64(nonce)], programId);
}

/** Associated token account; allowOwnerOffCurve because vaults and escrows are owned by PDAs. */
export function ata(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** Leg vault: ATA(basket, mint, token_2022). */
export function legVault(basket: PublicKey, legMint: PublicKey): PublicKey {
  return ata(basket, legMint, TOKEN_2022_PROGRAM_ID);
}

/** Ticket escrow: ATA(ticket, usdc_mint) with the classic token program (fixture USDC is classic SPL). */
export function ticketEscrow(ticket: PublicKey, usdcMint: PublicKey): PublicKey {
  return ata(ticket, usdcMint, TOKEN_PROGRAM_ID);
}

/** A fresh u64 nonce for a ticket; time-based with random low bits so two tabs don't collide. */
export function freshNonce(): bigint {
  const t = BigInt(Date.now()) << 16n;
  return t | BigInt(Math.floor(Math.random() * 0xffff));
}
