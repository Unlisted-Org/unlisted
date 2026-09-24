// Borsh decoding driven by an Anchor IDL (new format: `discriminator` arrays, `defined: {name}`).
// The basket reader follows A's published IDL instead of hand-copied offsets, so a layout change in
// the IDL can't be silently misread: a size or discriminator mismatch throws.

import { readFileSync } from "node:fs";
import { PublicKey } from "./web3.ts";

export type Idl = any;

export function loadIdl(path: string): Idl {
  return JSON.parse(readFileSync(path, "utf8"));
}

class Reader {
  b: Buffer;
  o = 0;
  constructor(b: Buffer) { this.b = b; }
  need(n: number) { if (this.o + n > this.b.length) throw new Error(`borsh: read past end (${this.o}+${n} > ${this.b.length})`); }
  u8() { this.need(1); return this.b[this.o++]; }
  bytes(n: number) { this.need(n); const x = this.b.subarray(this.o, this.o + n); this.o += n; return x; }
  uint(n: number): bigint { const x = this.bytes(n); let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(x[i]); return v; }
  int(n: number): bigint { const u = this.uint(n); const top = 1n << BigInt(n * 8 - 1); return u >= top ? u - (top << 1n) : u; }
}

function typeDef(idl: Idl, name: string) {
  const t = (idl.types ?? []).find((x: any) => x.name === name);
  if (!t) throw new Error(`IDL has no type ${name}`);
  return t.type;
}

/** Decode one value. Integers wider than 32 bits come back as decimal strings (exact). */
function decode(idl: Idl, ty: any, r: Reader): any {
  if (typeof ty === "string") {
    switch (ty) {
      case "bool": return r.u8() !== 0;
      case "u8": return r.u8();
      case "i8": return Number(r.int(1));
      case "u16": return Number(r.uint(2));
      case "i16": return Number(r.int(2));
      case "u32": return Number(r.uint(4));
      case "i32": return Number(r.int(4));
      case "u64": return r.uint(8).toString();
      case "i64": return r.int(8).toString();
      case "u128": return r.uint(16).toString();
      case "i128": return r.int(16).toString();
      case "pubkey": case "publicKey": return new PublicKey(r.bytes(32)).toBase58();
      case "string": { const n = Number(r.uint(4)); return r.bytes(n).toString("utf8"); }
      case "bytes": { const n = Number(r.uint(4)); return Buffer.from(r.bytes(n)).toString("base64"); }
      default: throw new Error(`borsh: unsupported primitive ${ty}`);
    }
  }
  if (ty.array) { const [inner, n] = ty.array; return Array.from({ length: n }, () => decode(idl, inner, r)); }
  if (ty.vec) { const n = Number(r.uint(4)); return Array.from({ length: n }, () => decode(idl, ty.vec, r)); }
  if (ty.option) return r.u8() ? decode(idl, ty.option, r) : null;
  if (ty.defined) return decodeDefined(idl, typeof ty.defined === "string" ? ty.defined : ty.defined.name, r);
  throw new Error(`borsh: unsupported type ${JSON.stringify(ty)}`);
}

function decodeDefined(idl: Idl, name: string, r: Reader): any {
  const t = typeDef(idl, name);
  if (t.kind === "struct") {
    const out: any = {};
    for (const f of t.fields ?? []) out[f.name] = decode(idl, f.type, r);
    return out;
  }
  if (t.kind === "enum") {
    const i = r.u8();
    const v = t.variants[i];
    if (!v) throw new Error(`borsh: ${name} has no variant ${i}`);
    if (!v.fields?.length) return { kind: v.name };
    const out: any = { kind: v.name };
    v.fields.forEach((f: any, k: number) => { out[f.name ?? String(k)] = decode(idl, f.type ?? f, r); });
    return out;
  }
  throw new Error(`borsh: unsupported kind ${t.kind}`);
}

/** Decode an account by IDL account name; checks the 8-byte discriminator. */
export function decodeAccount(idl: Idl, name: string, data: Buffer): any {
  const acc = idl.accounts.find((a: any) => a.name === name);
  if (!acc) throw new Error(`IDL has no account ${name}`);
  const disc = Buffer.from(acc.discriminator);
  if (!data.subarray(0, 8).equals(disc)) throw new Error(`${name}: discriminator mismatch`);
  const r = new Reader(data);
  r.o = 8;
  return decodeDefined(idl, name, r);
}

export function accountDiscriminator(idl: Idl, name: string): Buffer {
  return Buffer.from(idl.accounts.find((a: any) => a.name === name).discriminator);
}

/** Decode Anchor events from a transaction's log messages ("Program data: <base64>"). */
export function decodeEvents(idl: Idl, logs: string[], programId: string): { name: string; data: any }[] {
  const out: { name: string; data: any }[] = [];
  const stack: string[] = [];
  for (const l of logs) {
    const inv = l.match(/^Program (\S+) invoke \[\d+\]$/);
    if (inv) { stack.push(inv[1]); continue; }
    if (/^Program \S+ (success|failed)/.test(l)) { stack.pop(); continue; }
    const m = l.match(/^Program data: (.+)$/);
    if (!m || stack[stack.length - 1] !== programId) continue;
    const buf = Buffer.from(m[1], "base64");
    const ev = (idl.events ?? []).find((e: any) => buf.subarray(0, 8).equals(Buffer.from(e.discriminator)));
    if (!ev) continue;
    const r = new Reader(buf);
    r.o = 8;
    out.push({ name: ev.name, data: decodeDefined(idl, ev.name, r) });
  }
  return out;
}
