// Transaction assembly: v0 messages with lookup tables, packing checks, sequential send.
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export const PACKET_DATA_SIZE = 1232;
/** Account locks per transaction (increase_tx_account_lock_limit is not active; Phase 0 Q3). */
export const MAX_TX_ACCOUNTS = 64;

export interface Lut { key: PublicKey; addresses: PublicKey[] }

export function toLutAccounts(luts: Lut[]): AddressLookupTableAccount[] {
  const seen = new Map<string, Lut>();
  for (const l of luts) seen.set(l.key.toBase58(), l);
  return [...seen.values()].map(
    (l) => new AddressLookupTableAccount({
      key: l.key,
      state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: l.addresses },
    }),
  );
}

export interface Packed { tx: VersionedTransaction; bytes: number; accounts: number; instructions: number }

/** Compile a v0 transaction and measure it. Returns null if it does not fit. */
export function tryCompile(payer: PublicKey, blockhash: string, ixs: TransactionInstruction[], luts: Lut[]): Packed | null {
  try {
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(toLutAccounts(luts));
    const accounts = msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
    const tx = new VersionedTransaction(msg);
    const bytes = tx.serialize().length;
    if (bytes > PACKET_DATA_SIZE || accounts > MAX_TX_ACCOUNTS) return null;
    return { tx, bytes, accounts, instructions: ixs.length };
  } catch {
    return null; // serialization overflow
  }
}

export function measure(payer: PublicKey, blockhash: string, ixs: TransactionInstruction[], luts: Lut[]): { bytes: number | null; accounts: number } {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(toLutAccounts(luts));
  const accounts = msg.staticAccountKeys.length + msg.addressTableLookups.reduce((a, l) => a + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  let bytes: number | null = null;
  try { bytes = new VersionedTransaction(msg).serialize().length; } catch { bytes = null; }
  return { bytes, accounts };
}

export function computeBudget(units = 1_400_000, microLamports = 0): TransactionInstruction[] {
  const out = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
  if (microLamports > 0) out.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  return out;
}

/**
 * Confirmation by polling getSignatureStatuses over HTTP (no websocket: public RPCs limit new
 * connections per IP). Resends the same signed bytes while waiting, until the blockhash expires.
 */
export async function confirmByPolling(conn: Connection, sig: string, raw?: Uint8Array, timeoutMs = 120_000): Promise<{ slot: number | null; err: unknown }> {
  const start = Date.now();
  for (let n = 0; Date.now() - start < timeoutMs; n++) {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: n > 0 && n % 5 === 0 })).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" || st.err)) return { slot: st.slot, err: st.err };
    if (raw && n > 0 && n % 4 === 0) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3_000)); // >= 3 s between status polls (public RPC quota)
  }
  throw new Error(`transaction ${sig} not confirmed within ${timeoutMs / 1000} s`);
}

export interface SentTx { signature: string; slot: number | null; err: unknown }

/**
 * Send already-signed transactions in order, confirming each before the next (the second deposit
 * transaction needs the ticket the first one opens). Stops at the first failure.
 */
export async function sendSequential(conn: Connection, txs: VersionedTransaction[], onSent?: (i: number, sig: string) => void): Promise<SentTx[]> {
  const out: SentTx[] = [];
  for (let i = 0; i < txs.length; i++) {
    const raw = txs[i].serialize();
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
    onSent?.(i, sig);
    const st = await confirmByPolling(conn, sig, raw);
    out.push({ signature: sig, slot: st.slot, err: st.err });
    if (st.err) break;
  }
  return out;
}

/**
 * Addresses every basket transaction repeats (programs, basket, share mint, USDC, leg mints and
 * vaults, router). Put in one lookup table, they shrink the ticket transactions enough to pack
 * more legs each (see scripts/measure-packing.ts).
 */
export function basketLookupAddresses(p: {
  programId: PublicKey; basket: PublicKey; shareMint: PublicKey; usdcMint: PublicKey; legs: { mint: PublicKey; vault: PublicKey }[]; routers: PublicKey[];
}): PublicKey[] {
  const fixed = [
    "11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "SysvarRent111111111111111111111111111111111",
  ].map((k) => new PublicKey(k));
  const all = [...fixed, p.programId, p.basket, p.shareMint, p.usdcMint, ...p.legs.flatMap((l) => [l.mint, l.vault]), ...p.routers];
  const seen = new Set<string>();
  return all.filter((k) => (seen.has(k.toBase58()) ? false : (seen.add(k.toBase58()), true)));
}
