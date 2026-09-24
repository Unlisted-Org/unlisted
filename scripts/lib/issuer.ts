// Raw Token-2022 issuer-authority instructions (encodings checked against spl-token-2022 8.0.1).
// Raw amounts only: nothing here goes through a UI amount, so the scaled-UI multiplier can't leak in.
// Every scenario re-reads the mint or account after sending, so a wrong encoding fails loudly.

import { PublicKey, TransactionInstruction } from "../../services/valuation/src/lib/web3.ts";
import { TOKEN_2022_PROGRAM } from "../../services/valuation/src/lib/token2022.ts";

const T22 = new PublicKey(TOKEN_2022_PROGRAM);
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const mintAuth = (mint: PublicKey, authority: PublicKey) => [
  { pubkey: mint, isSigner: false, isWritable: true },
  { pubkey: authority, isSigner: true, isWritable: false },
];

/** BurnChecked (15). The permanent delegate may burn from any account of the mint. */
export const ixBurnChecked = (account: PublicKey, mint: PublicKey, authority: PublicKey, amount: bigint, decimals: number) =>
  new TransactionInstruction({
    programId: T22,
    data: Buffer.concat([Buffer.from([15]), u64(amount), Buffer.from([decimals])]),
    keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false }],
  });

/** TransferFeeExtension (26) / SetTransferFee (5): newer fee takes effect two epochs out. */
export const ixSetTransferFee = (mint: PublicKey, authority: PublicKey, bps: number, maximumFee: bigint) => {
  const d = Buffer.alloc(12);
  d[0] = 26; d[1] = 5; d.writeUInt16LE(bps, 2); d.writeBigUInt64LE(maximumFee, 4);
  return new TransactionInstruction({ programId: T22, data: d, keys: mintAuth(mint, authority) });
};

/** ScaledUiAmountExtension (43) / UpdateMultiplier (1): f64 multiplier, i64 effective timestamp. */
export const ixUpdateMultiplier = (mint: PublicKey, authority: PublicKey, multiplier: number, effectiveTs: number) => {
  const d = Buffer.alloc(18);
  d[0] = 43; d[1] = 1; d.writeDoubleLE(multiplier, 2); d.writeBigInt64LE(BigInt(effectiveTs), 10);
  return new TransactionInstruction({ programId: T22, data: d, keys: mintAuth(mint, authority) });
};

/** PausableExtension (44) / Pause (1) or Resume (2). */
export const ixPause = (mint: PublicKey, authority: PublicKey, pause: boolean) =>
  new TransactionInstruction({ programId: T22, data: Buffer.from([44, pause ? 1 : 2]), keys: mintAuth(mint, authority) });

/** TransferHookExtension (36) / Update (1). `program` null disables the hook (all-zero pubkey). */
export const ixSetHook = (mint: PublicKey, authority: PublicKey, program: PublicKey | null) =>
  new TransactionInstruction({ programId: T22, data: Buffer.concat([Buffer.from([36, 1]), program ? program.toBuffer() : Buffer.alloc(32)]), keys: mintAuth(mint, authority) });

/** DefaultAccountStateExtension (28) / Update (1). State: 1 initialized, 2 frozen. Signed by the freeze authority. */
export const ixSetDefaultState = (mint: PublicKey, freezeAuthority: PublicKey, frozen: boolean) =>
  new TransactionInstruction({ programId: T22, data: Buffer.from([28, 1, frozen ? 2 : 1]), keys: mintAuth(mint, freezeAuthority) });

/** FreezeAccount (10) / ThawAccount (11). */
export const ixFreeze = (account: PublicKey, mint: PublicKey, freezeAuthority: PublicKey, freeze: boolean) =>
  new TransactionInstruction({
    programId: T22,
    data: Buffer.from([freeze ? 10 : 11]),
    keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: freezeAuthority, isSigner: true, isWritable: false }],
  });

/** fixture_hook InitializeExtraAccountMetaList: creates the validation PDA with an empty list. */
export function ixInitHookValidation(hookProgram: PublicKey, mint: PublicKey, payer: PublicKey) {
  const [validation] = PublicKey.findProgramAddressSync([Buffer.from("extra-account-metas"), mint.toBuffer()], hookProgram);
  return {
    validation,
    ix: new TransactionInstruction({
      programId: hookProgram,
      data: Buffer.from([43, 34, 13, 49, 167, 88, 235, 235]),
      keys: [
        { pubkey: validation, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
      ],
    }),
  };
}
