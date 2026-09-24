// Client for fixtures/amm (fixture_amm): addresses, instruction encoders, and the exact integer
// swap maths the program runs, so quotes can be compared to measured deliveries unit for unit.

import { PublicKey, TransactionInstruction, SystemProgram } from "./web3.ts";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM, transferFee } from "./token2022.ts";

export const SIDE_BUY = 0; // USDC in, leg out
export const SIDE_SELL = 1; // leg in, USDC out

const pk = (x: string | PublicKey) => (typeof x === "string" ? new PublicKey(x) : x);

export function ata(owner: string | PublicKey, mint: string | PublicKey, tokenProgram: string): PublicKey {
  return PublicKey.findProgramAddressSync([pk(owner).toBuffer(), pk(tokenProgram).toBuffer(), pk(mint).toBuffer()], pk(ATA_PROGRAM))[0];
}

export function poolAddress(program: string | PublicKey, legMint: string | PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), pk(legMint).toBuffer()], pk(program))[0];
}

export function poolAccounts(program: string, legMint: string, usdcMint: string, usdcTokenProgram = TOKEN_PROGRAM) {
  const pool = poolAddress(program, legMint);
  return {
    pool,
    legVault: ata(pool, legMint, TOKEN_2022_PROGRAM),
    usdcVault: ata(pool, usdcMint, usdcTokenProgram),
  };
}

const u64le = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};

export function ixInitPool(program: string, payer: PublicKey, admin: PublicKey, legMint: string, usdcMint: string, feeBps: number, usdcTokenProgram = TOKEN_PROGRAM) {
  const a = poolAccounts(program, legMint, usdcMint, usdcTokenProgram);
  const data = Buffer.alloc(3);
  data[0] = 0;
  data.writeUInt16LE(feeBps, 1);
  return new TransactionInstruction({
    programId: pk(program),
    data,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: a.pool, isSigner: false, isWritable: true },
      { pubkey: pk(legMint), isSigner: false, isWritable: false },
      { pubkey: pk(usdcMint), isSigner: false, isWritable: false },
      { pubkey: a.legVault, isSigner: false, isWritable: false },
      { pubkey: a.usdcVault, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Swap. `taker` signs (a wallet, or a program PDA via invoke_signed); output goes to any `destination`. */
export function ixSwap(p: {
  program: string; legMint: string; usdcMint: string; taker: PublicKey; source: PublicKey; destination: PublicKey;
  amountIn: bigint; minOut: bigint; side: number; usdcTokenProgram?: string;
}) {
  const usdcTp = p.usdcTokenProgram ?? TOKEN_PROGRAM;
  const a = poolAccounts(p.program, p.legMint, p.usdcMint, usdcTp);
  return new TransactionInstruction({
    programId: pk(p.program),
    data: Buffer.concat([Buffer.from([1]), u64le(p.amountIn), u64le(p.minOut), Buffer.from([p.side])]),
    keys: [
      { pubkey: a.pool, isSigner: false, isWritable: false },
      { pubkey: pk(p.legMint), isSigner: false, isWritable: false },
      { pubkey: pk(p.usdcMint), isSigner: false, isWritable: false },
      { pubkey: a.legVault, isSigner: false, isWritable: true },
      { pubkey: a.usdcVault, isSigner: false, isWritable: true },
      { pubkey: p.taker, isSigner: true, isWritable: false },
      { pubkey: p.source, isSigner: false, isWritable: true },
      { pubkey: p.destination, isSigner: false, isWritable: true },
      { pubkey: pk(TOKEN_2022_PROGRAM), isSigner: false, isWritable: false },
      { pubkey: pk(usdcTp), isSigner: false, isWritable: false },
    ],
  });
}

export function ixAdminWithdraw(program: string, admin: PublicKey, legMint: string, usdcMint: string, side: number, destination: PublicKey, amount: bigint, usdcTokenProgram = TOKEN_PROGRAM) {
  const a = poolAccounts(program, legMint, usdcMint, usdcTokenProgram);
  const leg = side === 0;
  return new TransactionInstruction({
    programId: pk(program),
    data: Buffer.concat([Buffer.from([2]), u64le(amount), Buffer.from([side])]),
    keys: [
      { pubkey: a.pool, isSigner: false, isWritable: false },
      { pubkey: admin, isSigner: true, isWritable: false },
      { pubkey: leg ? a.legVault : a.usdcVault, isSigner: false, isWritable: true },
      { pubkey: pk(leg ? legMint : usdcMint), isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: pk(leg ? TOKEN_2022_PROGRAM : usdcTokenProgram), isSigner: false, isWritable: false },
    ],
  });
}

/** Decode a pool account (164 bytes). */
export function decodePool(data: Buffer) {
  if (data.length !== 164 || data[0] !== 0xa1) throw new Error("not a fixture_amm pool");
  const k = (o: number) => new PublicKey(data.subarray(o, o + 32)).toBase58();
  return { bump: data[1], fee_bps: data.readUInt16LE(2), admin: k(4), leg_mint: k(36), usdc_mint: k(68), leg_vault: k(100), usdc_vault: k(132) };
}

export interface SwapQuote {
  amount_in: bigint;
  pool_received: bigint; // input net of the leg's transfer fee (sell side)
  pool_out: bigint; // gross amount the pool sends
  delivered: bigint; // what the destination's balance rises by (net of the leg's fee on buys)
  in_fee: bigint;
  out_fee: bigint;
}

/**
 * Exactly the program's integer maths:
 *   received = measured in-vault delta (amount_in minus the Token-2022 fee on a leg input)
 *   eff      = floor(received * (10_000 - lp_fee_bps) / 10_000)
 *   out      = floor(out_reserve * eff / (in_reserve + eff))
 *   delivered = out minus the Token-2022 fee on a leg output
 */
export function quoteSwap(p: { side: number; amountIn: bigint; legReserve: bigint; usdcReserve: bigint; lpFeeBps: number; legFeeBps: number }): SwapQuote {
  const sell = p.side === SIDE_SELL;
  const inRes = sell ? p.legReserve : p.usdcReserve;
  const outRes = sell ? p.usdcReserve : p.legReserve;
  const inFee = sell ? transferFee(p.amountIn, p.legFeeBps) : 0n;
  const received = p.amountIn - inFee;
  const eff = (received * BigInt(10_000 - p.lpFeeBps)) / 10_000n;
  const out = (outRes * eff) / (inRes + eff);
  const outFee = sell ? 0n : transferFee(out, p.legFeeBps);
  return { amount_in: p.amountIn, pool_received: received, pool_out: out, delivered: out - outFee, in_fee: inFee, out_fee: outFee };
}

// --- plain SPL token instructions (same encodings in Token and Token-2022) ---

export function ixCreateAtaIdempotent(payer: PublicKey, owner: string | PublicKey, mint: string | PublicKey, tokenProgram: string) {
  const address = ata(owner, mint, tokenProgram);
  return {
    address,
    ix: new TransactionInstruction({
      programId: pk(ATA_PROGRAM),
      data: Buffer.from([1]),
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: address, isSigner: false, isWritable: true },
        { pubkey: pk(owner), isSigner: false, isWritable: false },
        { pubkey: pk(mint), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: pk(tokenProgram), isSigner: false, isWritable: false },
      ],
    }),
  };
}

export function ixMintToChecked(tokenProgram: string, mint: string | PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint, decimals: number) {
  return new TransactionInstruction({
    programId: pk(tokenProgram),
    data: Buffer.concat([Buffer.from([14]), u64le(amount), Buffer.from([decimals])]),
    keys: [
      { pubkey: pk(mint), isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
  });
}

export function ixTransferChecked(tokenProgram: string, source: PublicKey, mint: string | PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint, decimals: number) {
  return new TransactionInstruction({
    programId: pk(tokenProgram),
    data: Buffer.concat([Buffer.from([12]), u64le(amount), Buffer.from([decimals])]),
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: pk(mint), isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
  });
}
