export const int = (v: string | number) => BigInt(v).toLocaleString("en-US");
export const slot = (v: number | null) => (v === null ? "" : v.toLocaleString("en-US"));
export const shortSig = (sig: string) => `${sig.slice(0, 6)}…${sig.slice(-6)}`;
