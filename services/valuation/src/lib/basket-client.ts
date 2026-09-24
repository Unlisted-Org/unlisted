// Minimal client for A's `basket` program, driven by its IDL (instruction discriminators, account order,
// borsh args). Used by the redeem-payout check and the local program basket; never on mainnet.

import { PublicKey, TransactionInstruction } from "./web3.ts";
import { encodeInstruction, instructionAccounts } from "./idl.ts";
import type { Idl } from "./idl.ts";
import { ata } from "./amm.ts";
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "./token2022.ts";

const pk = (s: string | PublicKey) => (typeof s === "string" ? new PublicKey(s) : s);

export function basketPda(program: string, shareMint: string) {
  return PublicKey.findProgramAddressSync([Buffer.from("basket"), pk(shareMint).toBuffer()], pk(program))[0];
}

export function redeemTicketPda(program: string, basket: string, owner: string, nonce: bigint) {
  const n = Buffer.alloc(8);
  n.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync([Buffer.from("redeem"), pk(basket).toBuffer(), pk(owner).toBuffer(), n], pk(program))[0];
}

function build(idl: Idl, name: string, accounts: Record<string, string | undefined>, args: Record<string, any>, remaining: { pubkey: string; isSigner?: boolean; isWritable: boolean }[] = []) {
  const keys = [...instructionAccounts(idl, name, accounts), ...remaining.map((r) => ({ pubkey: r.pubkey, isSigner: Boolean(r.isSigner), isWritable: r.isWritable }))];
  return new TransactionInstruction({ programId: pk(idl.address), data: encodeInstruction(idl, name, args), keys: keys.map((k) => ({ pubkey: pk(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })) });
}

export interface LegRef { mint: string; mirror_of?: string }

export function ixInitializeBasket(idl: Idl, p: { payer: string; authority: string; shareMint: string; usdcMint: string; legs: LegRef[]; maxConvertChunk: bigint; routers: string[] }) {
  const basket = basketPda(idl.address, p.shareMint).toBase58();
  return build(idl, "initialize_basket", {
    payer: p.payer, authority: p.authority, basket, share_mint: p.shareMint, usdc_mint: p.usdcMint,
    usdc_reserve: ata(basket, p.usdcMint, TOKEN_PROGRAM).toBase58(),
  }, { n_legs: p.legs.length, mirror_of: p.legs.map((l) => l.mirror_of), max_convert_chunk: p.maxConvertChunk, routers: p.routers },
  p.legs.flatMap((l) => [{ pubkey: l.mint, isWritable: false }, { pubkey: ata(basket, l.mint, TOKEN_2022_PROGRAM).toBase58(), isWritable: true }]));
}

/** Per-leg (mint, vault, user token account) triples, active legs in order. */
function triples(basket: string, owner: string, legs: LegRef[]) {
  return legs.flatMap((l) => [
    { pubkey: l.mint, isWritable: false },
    { pubkey: ata(basket, l.mint, TOKEN_2022_PROGRAM).toBase58(), isWritable: true },
    { pubkey: ata(owner, l.mint, TOKEN_2022_PROGRAM).toBase58(), isWritable: true },
  ]);
}

export function ixDeposit(idl: Idl, kind: "bootstrap" | "deposit_in_kind", p: { depositor: string; shareMint: string; legs: LegRef[]; gross: bigint[]; minShares?: bigint }) {
  const basket = basketPda(idl.address, p.shareMint).toBase58();
  return build(idl, kind, { depositor: p.depositor, basket, share_mint: p.shareMint, depositor_share_ata: ata(p.depositor, p.shareMint, TOKEN_PROGRAM).toBase58() },
    kind === "bootstrap" ? { gross: p.gross } : { gross: p.gross, min_shares: p.minShares ?? 1n }, triples(basket, p.depositor, p.legs));
}

export function ixRedeem(idl: Idl, p: { owner: string; shareMint: string; nonce: bigint; shares: bigint; mode: any; legs: LegRef[] }) {
  const basket = basketPda(idl.address, p.shareMint).toBase58();
  return build(idl, "redeem", {
    owner: p.owner, basket, share_mint: p.shareMint, owner_share_ata: ata(p.owner, p.shareMint, TOKEN_PROGRAM).toBase58(),
    ticket: redeemTicketPda(idl.address, basket, p.owner, p.nonce).toBase58(),
  }, { nonce: p.nonce, shares: p.shares, mode: p.mode }, triples(basket, p.owner, p.legs));
}
