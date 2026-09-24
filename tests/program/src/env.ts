// LiteSVM environment: the real basket .so, the mainnet Token-2022 / Token / ATA binaries, and a test-only router.
import { LiteSVM, Clock } from "litesvm";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, MessageV0, PublicKey, Transaction, TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const IDL: Idl = JSON.parse(fs.readFileSync(path.join(ROOT, "programs/basket/idl/basket.json"), "utf8"));
export const PROGRAM_ID = new PublicKey((IDL as any).address);
export const ROUTER_ID = new PublicKey("HcxyNQvEA6rBbc7yLxKHQPttWHXPyvhHz6s5YrVnLifF");
export const T22 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM = new PublicKey("11111111111111111111111111111111");
export const coder = new BorshCoder(IDL);
const SYSTEM_ID = new PublicKey("11111111111111111111111111111111");

const ERRORS: Record<number, string> = Object.fromEntries(((IDL as any).errors ?? []).map((e: any) => [e.code, e.name]));

export interface TxResult {
  ok: boolean;
  logs: string[];
  cu: number;
  error?: string; // basket error name, or a token/other program error string
  events: { name: string; data: any }[];
  signature: string;
  size: number;
}

/** Deterministic keypair from a label (test owners, issuer, etc.). */
export function kp(label: string): Keypair {
  return Keypair.fromSeed(createHash("sha256").update("stocklana-test:" + label).digest());
}

export class Svm {
  svm: LiteSVM;
  inner: any;
  payer: Keypair;
  txCount = 0;

  constructor() {
    this.svm = new LiteSVM().withTransactionHistory(0n).withLogBytesLimit(100_000n);
    this.inner = (this.svm as any).inner;
    const fx = path.join(ROOT, "tests/program/fixtures");
    // Mainnet binaries (solana program dump -um), so Token-2022 behaves exactly as on mainnet.
    this.svm.addProgramFromFile(T22.toBase58() as any, path.join(fx, "token2022.so"));
    this.svm.addProgramFromFile(TOKEN.toBase58() as any, path.join(fx, "token.so"));
    this.svm.addProgramFromFile(ATA.toBase58() as any, path.join(fx, "ata.so"));
    this.svm.addProgramFromFile(PROGRAM_ID.toBase58() as any, path.join(ROOT, "target/deploy/basket.so"));
    this.svm.addProgramFromFile(ROUTER_ID.toBase58() as any, path.join(ROOT, "target/deploy/mock_router.so"));
    this.payer = kp("payer");
    this.fund(this.payer.publicKey, 1_000_000n * 1_000_000_000n);
  }

  /** Set a system account's balance (LiteSVM's airdrop faucet is finite). */
  fund(pk: PublicKey, lamports: bigint) {
    const cur = this.account(pk);
    if (cur && !cur.owner.equals(SYSTEM_ID)) throw new Error("fund: not a system account " + pk.toBase58());
    this.svm.setAccount({ address: pk.toBase58(), data: new Uint8Array(0), programAddress: SYSTEM_ID.toBase58(), executable: false, lamports } as any);
  }

  account(pk: PublicKey): { data: Buffer; owner: PublicKey; lamports: bigint } | null {
    const a = this.inner.getAccount(pk.toBytes());
    if (!a) return null;
    return { data: Buffer.from(a.data()), owner: new PublicKey(a.owner()), lamports: a.lamports() };
  }

  setAccount(pk: PublicKey, data: Buffer, owner: PublicKey, lamports?: bigint) {
    const l = lamports ?? this.svm.minimumBalanceForRentExemption(BigInt(data.length));
    this.svm.setAccount({ address: pk.toBase58(), data: new Uint8Array(data), programAddress: owner.toBase58(), executable: false, lamports: l } as any);
  }

  clock(): Clock {
    return this.svm.getClock();
  }

  /** Advance the clock: epochs (transfer-fee schedule), seconds (listing timelock) and/or slots (ticket expiry). */
  warp(opts: { epochs?: number; seconds?: number; slots?: number }) {
    const c = this.svm.getClock();
    if (opts.epochs) c.epoch = c.epoch + BigInt(opts.epochs);
    if (opts.seconds) c.unixTimestamp = c.unixTimestamp + BigInt(opts.seconds);
    if (opts.slots) c.slot = c.slot + BigInt(opts.slots);
    this.svm.setClock(c);
  }

  /** Write an address lookup table account directly (all addresses active). Client-side only: no program semantics. */
  setLookupTable(key: PublicKey, addresses: PublicKey[]): AddressLookupTableAccount {
    const header = Buffer.alloc(56);
    header.writeUInt32LE(1, 0); // LookupTable
    header.writeBigUInt64LE((1n << 64n) - 1n, 4); // deactivation slot: never
    header.writeBigUInt64LE(0n, 12); // last extended slot
    header[20] = addresses.length; // last extended start index: everything active
    header[21] = 0; // no authority (frozen)
    const data = Buffer.concat([header, ...addresses.map((a) => a.toBuffer())]);
    this.setAccount(key, data, new PublicKey("AddressLookupTab1e1111111111111111111111111"));
    if (this.clock().slot < 1n) this.svm.warpToSlot(1n);
    return new AddressLookupTableAccount({ key, state: AddressLookupTableAccount.deserialize(data) });
  }

  send(ixs: TransactionInstruction[], signers: Keypair[] = [], cuLimit = 1_400_000, alts: AddressLookupTableAccount[] = []): TxResult {
    const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }), ...ixs];
    const uniq = new Map<string, Keypair>();
    for (const s of [this.payer, ...signers]) uniq.set(s.publicKey.toBase58(), s);
    let bytes: Uint8Array;
    let sig: Uint8Array;
    if (alts.length === 0) {
      const tx = new Transaction();
      tx.add(...all);
      tx.feePayer = this.payer.publicKey;
      tx.recentBlockhash = this.svm.latestBlockhash();
      tx.sign(...uniq.values());
      bytes = tx.serialize();
      sig = tx.signature!;
    } else {
      const msg = MessageV0.compile({ payerKey: this.payer.publicKey, instructions: all, recentBlockhash: this.svm.latestBlockhash(), addressLookupTableAccounts: alts });
      const vtx = new VersionedTransaction(msg);
      const need = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).map((k) => k.toBase58());
      vtx.sign([...uniq.values()].filter((k) => need.includes(k.publicKey.toBase58())));
      bytes = vtx.serialize();
      sig = vtx.signatures[0];
    }
    const r = alts.length === 0 ? this.inner.sendLegacyTransaction(bytes) : this.inner.sendVersionedTransaction(bytes);
    this.svm.expireBlockhash();
    this.txCount++;
    const failed = typeof r.err === "function";
    const meta = failed ? r.meta() : r;
    const logs: string[] = meta.logs();
    const res: TxResult = {
      ok: !failed,
      logs,
      cu: Number(meta.computeUnitsConsumed()),
      events: parseEvents(logs),
      signature: Buffer.from(sig).toString("hex"),
      size: bytes.length,
    };
    if (failed) res.error = errorName(logs, r.err());
    return res;
  }
}

export function errorName(logs: string[], err?: any): string {
  for (const l of logs) {
    const m = l.match(/Error Code: (\w+)/);
    if (m) return m[1];
  }
  for (const l of logs) {
    const m = l.match(/custom program error: (0x[0-9a-f]+)/i);
    if (m) {
      const code = parseInt(m[1], 16);
      return ERRORS[code] ?? `custom:${code}`;
    }
  }
  const fail = logs.find((l) => / failed: /.test(l));
  return fail ?? String(err ?? "unknown");
}

export function parseEvents(logs: string[]): { name: string; data: any }[] {
  const out: { name: string; data: any }[] = [];
  // Only events logged directly by the basket program (depth tracking of invoke/success lines).
  const stack: string[] = [];
  for (const l of logs) {
    let m = l.match(/^Program (\w+) invoke \[\d+\]$/);
    if (m) { stack.push(m[1]); continue; }
    m = l.match(/^Program (\w+) (success|failed)/);
    if (m) { stack.pop(); continue; }
    m = l.match(/^Program data: (.+)$/);
    if (m && stack[stack.length - 1] === PROGRAM_ID.toBase58()) {
      const ev = coder.events.decode(m[1]);
      if (ev) out.push(ev);
    }
  }
  return out;
}

export function u64le(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
