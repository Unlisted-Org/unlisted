// Minimal Borsh reader/writer (Anchor's encoding). Hand-written so the SDK can be built
// against spec 02 before the program's IDL exists; `scripts/idl-check.ts` compares the
// layouts below with the IDL once Agent A publishes it.
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";

export class Reader {
  off = 0;
  constructor(private readonly buf: Uint8Array) {}
  private view(n: number): DataView {
    if (this.off + n > this.buf.length) throw new RangeError(`read past end: ${this.off}+${n} > ${this.buf.length}`);
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.off, n);
    this.off += n;
    return v;
  }
  u8(): number { return this.view(1).getUint8(0); }
  bool(): boolean {
    const b = this.u8();
    if (b > 1) throw new Error(`invalid bool ${b}`);
    return b === 1;
  }
  u16(): number { return this.view(2).getUint16(0, true); }
  u32(): number { return this.view(4).getUint32(0, true); }
  u64(): bigint { return this.view(8).getBigUint64(0, true); }
  i64(): bigint { return this.view(8).getBigInt64(0, true); }
  u128(): bigint {
    const v = this.view(16);
    return v.getBigUint64(0, true) | (v.getBigUint64(8, true) << 64n);
  }
  f64(): number { return this.view(8).getFloat64(0, true); }
  bytes(n: number): Uint8Array {
    const out = this.buf.slice(this.off, this.off + n);
    if (out.length !== n) throw new RangeError("read past end");
    this.off += n;
    return out;
  }
  pubkey(): PublicKey { return new PublicKey(this.bytes(32)); }
  option<T>(f: () => T): T | null { return this.u8() === 0 ? null : f(); }
  array<T>(n: number, f: () => T): T[] { return Array.from({ length: n }, f); }
  vec<T>(f: () => T): T[] { return this.array(this.u32(), f); }
  remaining(): number { return this.buf.length - this.off; }
}

export class Writer {
  private parts: Uint8Array[] = [];
  private push(n: number, fill: (v: DataView) => void): this {
    const b = new Uint8Array(n);
    fill(new DataView(b.buffer));
    this.parts.push(b);
    return this;
  }
  raw(b: Uint8Array): this { this.parts.push(Uint8Array.from(b)); return this; }
  u8(x: number): this { return this.push(1, (v) => v.setUint8(0, x)); }
  bool(x: boolean): this { return this.u8(x ? 1 : 0); }
  u16(x: number): this { return this.push(2, (v) => v.setUint16(0, x, true)); }
  u32(x: number): this { return this.push(4, (v) => v.setUint32(0, x, true)); }
  u64(x: bigint): this {
    if (x < 0n || x >= 1n << 64n) throw new RangeError(`u64 out of range: ${x}`);
    return this.push(8, (v) => v.setBigUint64(0, x, true));
  }
  i64(x: bigint): this { return this.push(8, (v) => v.setBigInt64(0, x, true)); }
  u128(x: bigint): this {
    if (x < 0n || x >= 1n << 128n) throw new RangeError(`u128 out of range: ${x}`);
    return this.push(16, (v) => {
      v.setBigUint64(0, x & ((1n << 64n) - 1n), true);
      v.setBigUint64(8, x >> 64n, true);
    });
  }
  pubkey(k: PublicKey): this { return this.raw(k.toBytes()); }
  option<T>(x: T | null | undefined, f: (x: T) => void): this {
    if (x === null || x === undefined) return this.u8(0);
    this.u8(1);
    f(x);
    return this;
  }
  vec<T>(xs: T[], f: (x: T) => void): this {
    this.u32(xs.length);
    xs.forEach(f);
    return this;
  }
  bytesVec(b: Uint8Array): this { return this.u32(b.length).raw(b); }
  build(): Uint8Array {
    const n = this.parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

/** Anchor discriminator: first 8 bytes of sha256("<namespace>:<name>"). */
export function discriminator(namespace: "global" | "account" | "event", name: string): Uint8Array {
  return sha256(new TextEncoder().encode(`${namespace}:${name}`)).slice(0, 8);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function toLeU64(x: bigint): Uint8Array {
  return new Writer().u64(x).build();
}
