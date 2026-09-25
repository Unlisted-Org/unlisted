// Display helpers. Raw units in, strings out; the maths never uses these.
export function fmtRaw(raw: bigint, decimals = 9, maxFrac = 6): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const s = int.toLocaleString("en-US") + (frac ? "." + frac : "");
  return neg ? "-" + s : s;
}
export const fmtShares = (raw: bigint) => fmtRaw(raw, 9, 9);
export const fmtUsdc = (raw: bigint) => fmtRaw(raw, 6, 2);
export function parseUnits(s: string, decimals: number): bigint {
  const t = s.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") throw new Error(`not a number: ${s}`);
  const [i, f = ""] = t.split(".");
  if (f.length > decimals) throw new Error(`at most ${decimals} decimals`);
  return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}
export function fmtAge(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "age unknown";
  if (seconds < 90) return `${Math.round(seconds)} s old`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min old`;
  return `${(seconds / 3600).toFixed(1)} h old`;
}
export function fmtUsd(s: string | number | null | undefined): string {
  if (s == null || s === "…") return "—";
  const n = Number(s);
  return isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : String(s);
}
export function fmtBps(b: number): string {
  return `${b} bps (${(b / 100).toFixed(b % 100 ? 2 : 0)}%)`;
}
export function short(k: { toBase58(): string } | string): string {
  const s = typeof k === "string" ? k : k.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
export function pct(numer: bigint, denom: bigint, digits = 2): string {
  if (denom === 0n) return "—";
  const scale = 10n ** BigInt(digits + 2);
  const v = (numer * scale) / denom;
  const s = v.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits) || "0"}.${s.slice(-digits)}%`;
}
