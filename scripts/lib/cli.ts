// spl-token CLI wrapper. spl-token-cli 5.5.0 is the tool Phase 0 proved reproduces the PreStocks
// extension set; the scripts drive it rather than re-implementing each extension instruction.

import { execFileSync } from "node:child_process";
import { cliConfig, ISSUER_KEY, rpcFor, sleep } from "./env.ts";
import type { Cluster } from "./env.ts";

export function splToken(c: Cluster, args: string[], opts: { feePayer?: string; json?: boolean } = {}): any {
  const full = ["-C", cliConfig(c), ...args, "--fee-payer", opts.feePayer ?? ISSUER_KEY];
  if (opts.json !== false) full.push("--output", "json");
  let out = "";
  for (let attempt = 0; ; attempt++) {
    try {
      out = execFileSync("spl-token", full, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      break;
    } catch (e: any) {
      const msg = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      // Public devnet RPC rate limits: back off and retry. Callers make retries safe (fixed mint keypairs).
      if (attempt < 6 && /429|Too Many Requests|rate limit|Blockhash not found|BlockhashNotFound|timed out|connection closed/i.test(msg)) {
        execFileSync("sleep", [String(Math.min(30, 3 * 2 ** attempt))]);
        continue;
      }
      throw Object.assign(new Error(`spl-token ${args.join(" ")} failed:\n${msg}`), { output: msg });
    }
  }
  if (opts.json === false) return out;
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}

/** Find the transaction signature in any spl-token --output json result. */
export function signatureOf(result: any): string {
  const seen: string[] = [];
  const walk = (v: any) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "signature" && typeof x === "string") seen.push(x);
      else walk(x);
    }
  };
  walk(result);
  if (!seen.length && typeof result?.raw === "string") {
    const m = result.raw.match(/Signature:\s*([1-9A-HJ-NP-Za-km-z]{64,90})/);
    if (m) seen.push(m[1]);
  }
  if (!seen.length) throw new Error(`no signature in ${JSON.stringify(result)}`);
  return seen[seen.length - 1];
}

export interface TxRecord {
  step: string;
  signature: string;
  slot: number;
  block_time: number | null;
  block_time_iso: string | null;
  err: unknown;
}

/** Look the signature up on-chain and return its confirmed slot and block time. Throws if it failed. */
export async function confirmTx(c: Cluster, step: string, signature: string): Promise<TxRecord> {
  const rpc = rpcFor(c);
  for (let i = 0; i < 40; i++) {
    const tx = await rpc.transaction(signature).catch(() => null);
    if (tx) {
      if (tx.meta?.err) throw new Error(`${step}: tx ${signature} failed: ${JSON.stringify(tx.meta.err)}`);
      return {
        step,
        signature,
        slot: tx.slot,
        block_time: tx.blockTime ?? null,
        block_time_iso: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString().replace(".000Z", "Z") : null,
        err: null,
      };
    }
    await sleep(1000);
  }
  throw new Error(`${step}: ${signature} not found after 40 s`);
}

export async function runStep(c: Cluster, step: string, args: string[], opts: { feePayer?: string } = {}): Promise<TxRecord> {
  const res = splToken(c, args, opts);
  return confirmTx(c, step, signatureOf(res));
}
