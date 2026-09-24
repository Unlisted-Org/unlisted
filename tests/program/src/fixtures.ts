// Fixture mints with the PreStocks Token-2022 extension set, created by real Token-2022 instructions,
// plus the issuer actions the scenarios need (pause, hook, freeze, seize, fee change, mint).
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import { createInitializeInstruction as initMetadata } from "@solana/spl-token-metadata";
import { Svm, T22, TOKEN, kp, u64le } from "./env.ts";

export const U64_MAX = (1n << 64n) - 1n;
// Mainnet OPENAI's ConfidentialTransferFeeConfig withdraw-withheld ElGamal key (copied so the extension is well-formed).
const ELGAMAL = Buffer.from("6081d56ee42ad310ef5bc83cbd6d5e9da201c4876b9bbbfeec4c8488c6870e63", "hex");
// Fixed-size extension values: TransferFeeConfig, CTMint, DefaultAccountState, PermanentDelegate, TransferHook,
// CTFeeConfig, MetadataPointer, ScaledUiAmount, Pausable (each + 4-byte TLV header), after 165 + 1 base bytes.
const FIXED_EXT = [108, 65, 1, 32, 64, 129, 64, 56, 33];
const MINT_FIXED_LEN = 166 + FIXED_EXT.reduce((a, b) => a + b + 4, 0);

export const LEG_NAMES = ["OPENAI", "ANTHROPIC", "NEURALINK", "ANDURIL", "POLYMARKET", "KALSHI", "FIGUREAI"];

export type Unavail = "pause" | "hook" | "freeze";

/**
 * The two transactions that create a PreStocks-shaped fixture mint (also used on devnet). tx1[0] creates the
 * account with the fixed-extension size; `len` is the full size including metadata (fund lamports for it).
 */
export function legMintIxs(payer: PublicKey, m: PublicKey, a: PublicKey, label: string, feeBps: number, multiplier = 1, lamports = 0) {
  const name = `${label} PreStock (fixture)`;
  const symbol = label;
  const uri = "https://stocklana.invalid/" + label.toLowerCase();
  const metaLen = 4 + 32 + 32 + 4 + name.length + 4 + symbol.length + 4 + uri.length + 4;
  const ct = new TransactionInstruction({ programId: T22, keys: [{ pubkey: m, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([27, 0]), a.toBuffer(), Buffer.from([0]), Buffer.alloc(32)]) });
  const ctFee = new TransactionInstruction({ programId: T22, keys: [{ pubkey: m, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([37, 0]), a.toBuffer(), ELGAMAL]) });
  const tx1 = [
    SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: m, space: MINT_FIXED_LEN, lamports, programId: T22 }),
    spl.createInitializeTransferFeeConfigInstruction(m, a, a, feeBps, U64_MAX, T22),
    ct,
    spl.createInitializeDefaultAccountStateInstruction(m, spl.AccountState.Initialized, T22),
    spl.createInitializePermanentDelegateInstruction(m, a, T22),
    spl.createInitializeTransferHookInstruction(m, a, PublicKey.default, T22),
  ];
  const tx2 = [
    ctFee,
    spl.createInitializeMetadataPointerInstruction(m, a, m, T22),
    spl.createInitializeScaledUiAmountConfigInstruction(m, a, multiplier, T22),
    spl.createInitializePausableConfigInstruction(m, a, T22),
    spl.createInitializeMintInstruction(m, 9, a, a, T22),
    initMetadata({ programId: T22, metadata: m, updateAuthority: a, mint: m, mintAuthority: a, name, symbol, uri }),
  ];
  return { tx1, tx2, len: MINT_FIXED_LEN + metaLen };
}

export class Issuer {
  constructor(public env: Svm, public key: Keypair = kp("fixture-issuer")) {
    env.fund(key.publicKey, 1000n * 1_000_000_000n);
  }

  /** A Token-2022 mint with the exact PreStocks extension set (spec 02 Fixtures). */
  createLegMint(label: string, feeBps: number, multiplier = 1, mint: Keypair = kp("mint:" + label)): PublicKey {
    const { tx1, tx2, len } = legMintIxs(this.env.payer.publicKey, mint.publicKey, this.key.publicKey, label, feeBps, multiplier);
    const lamports = this.env.svm.minimumBalanceForRentExemption(BigInt(len));
    tx1[0] = SystemProgram.createAccount({ fromPubkey: this.env.payer.publicKey, newAccountPubkey: mint.publicKey, space: MINT_FIXED_LEN, lamports: Number(lamports), programId: T22 });
    const r1 = this.env.send(tx1, [mint]);
    if (!r1.ok) throw new Error("mint tx1 failed: " + r1.error + r1.logs.join("\n"));
    const r2 = this.env.send(tx2, [this.key]);
    if (!r2.ok) throw new Error("mint tx2 failed: " + r2.logs.join("\n"));
    return mint.publicKey;
  }

  /** Byte-for-byte copy of an existing fixture mint at a new address (metadata `mint` field patched). */
  cloneMint(template: PublicKey, to: PublicKey) {
    const src = this.env.account(template)!;
    const data = Buffer.from(src.data);
    const t = template.toBuffer();
    for (let i = data.indexOf(t); i >= 0; i = data.indexOf(t, i + 32)) to.toBuffer().copy(data, i);
    this.env.setAccount(to, data, T22, src.lamports);
  }

  createUsdc(mint: Keypair = kp("usdc")): PublicKey {
    const lamports = this.env.svm.minimumBalanceForRentExemption(82n);
    const r = this.env.send([
      SystemProgram.createAccount({ fromPubkey: this.env.payer.publicKey, newAccountPubkey: mint.publicKey, space: 82, lamports: Number(lamports), programId: TOKEN }),
      spl.createInitializeMint2Instruction(mint.publicKey, 6, this.key.publicKey, null, TOKEN),
    ], [mint]);
    if (!r.ok) throw new Error("usdc: " + r.logs.join("\n"));
    return mint.publicKey;
  }

  ata(owner: PublicKey, mint: PublicKey, program = T22): PublicKey {
    return spl.getAssociatedTokenAddressSync(mint, owner, true, program);
  }

  createAtaIx(owner: PublicKey, mint: PublicKey, program = T22) {
    return spl.createAssociatedTokenAccountIdempotentInstruction(this.env.payer.publicKey, this.ata(owner, mint, program), owner, mint, program);
  }

  mintTo(mint: PublicKey, dest: PublicKey, amount: bigint, program = T22) {
    const r = this.env.send([spl.createMintToInstruction(mint, dest, this.key.publicKey, amount, [], program)], [this.key]);
    if (!r.ok) throw new Error("mintTo: " + r.error);
    return r;
  }

  // ---- issuer actions (real Token-2022 instructions signed by the fixture issuer) ----
  pause(mint: PublicKey) { return this.must([spl.createPauseInstruction(mint, this.key.publicKey, [], T22)], "pause"); }
  resume(mint: PublicKey) { return this.must([spl.createResumeInstruction(mint, this.key.publicKey, [], T22)], "resume"); }
  setHook(mint: PublicKey, program: PublicKey) {
    return this.must([spl.createUpdateTransferHookInstruction(mint, this.key.publicKey, program, [], T22)], "hook");
  }
  freeze(account: PublicKey, mint: PublicKey) { return this.must([spl.createFreezeAccountInstruction(account, mint, this.key.publicKey, [], T22)], "freeze"); }
  thaw(account: PublicKey, mint: PublicKey) { return this.must([spl.createThawAccountInstruction(account, mint, this.key.publicKey, [], T22)], "thaw"); }
  /** Permanent-delegate burn out of any account, e.g. a basket vault (the vault does not sign). */
  seize(account: PublicKey, mint: PublicKey, amount: bigint) {
    return this.must([spl.createBurnCheckedInstruction(account, mint, this.key.publicKey, amount, 9, [], T22)], "seize");
  }
  /** set-transfer-fee; takes effect two epochs later, as on mainnet. */
  setFee(mint: PublicKey, bps: number) {
    return this.must([spl.createSetTransferFeeInstruction(mint, this.key.publicKey, [], bps, U64_MAX, T22)], "setFee");
  }

  private must(ixs: TransactionInstruction[], what: string) {
    const r = this.env.send(ixs, [this.key]);
    if (!r.ok) throw new Error(`${what} failed: ${r.error}\n${r.logs.join("\n")}`);
    return r;
  }
}

// ---- raw readers ----
export function tokenAmount(env: Svm, acc: PublicKey): bigint {
  const a = env.account(acc);
  if (!a) return 0n;
  return a.data.readBigUInt64LE(64);
}
export function tokenState(env: Svm, acc: PublicKey): number {
  return env.account(acc)!.data[108];
}
export function mintSupply(env: Svm, mint: PublicKey): bigint {
  return env.account(mint)!.data.readBigUInt64LE(36);
}
/** Withheld transfer-fee amount on a Token-2022 account (TransferFeeAmount extension, type 2). */
export function withheld(env: Svm, acc: PublicKey): bigint {
  const d = env.account(acc)!.data;
  for (let o = 166; o + 4 <= d.length;) {
    const t = d.readUInt16LE(o), l = d.readUInt16LE(o + 2);
    if (t === 2) return d.readBigUInt64LE(o + 4);
    if (t === 0) break;
    o += 4 + l;
  }
  return 0n;
}
export { u64le };
