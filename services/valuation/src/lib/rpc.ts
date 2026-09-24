// Minimal JSON-RPC client with retry and fallback URLs. Reads only; nothing here signs.

export const CLUSTER_URLS: Record<string, string[]> = {
  mainnet: [
    process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com",
    "https://solana-mainnet.gateway.tatum.io",
  ],
  devnet: [process.env.DEVNET_RPC ?? "https://api.devnet.solana.com"],
  local: [process.env.LOCAL_RPC ?? "http://127.0.0.1:8901"],
};

export class RpcError extends Error {
  code: number | undefined;
  data: unknown;
  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON.parse that keeps integers above 2^53 exact, as strings (e.g. maximumFee = u64::MAX, which a
 * plain parse turns into 18446744073709552000). Uses the reviver's source-text access (Node >= 21).
 */
export function parseExact(text: string): any {
  return JSON.parse(text, (_k, v, ctx?: { source?: string }) =>
    typeof v === "number" && !Number.isSafeInteger(v) && ctx?.source && /^-?\d+$/.test(ctx.source) ? ctx.source : v,
  );
}

export class Rpc {
  urls: string[];
  cluster: string;
  commitment: string;
  constructor(cluster: string, urls?: string[], commitment = "confirmed") {
    this.cluster = cluster;
    this.urls = urls ?? CLUSTER_URLS[cluster];
    if (!this.urls) throw new Error(`unknown cluster ${cluster}`);
    this.commitment = commitment;
  }

  async call<T = any>(method: string, params: unknown[] = []): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      const url = this.urls[attempt % this.urls.length];
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new RpcError(`${url} HTTP ${res.status}`);
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const body: any = parseExact(await res.text());
        if (body.error) {
          // Deterministic RPC errors are not retried.
          throw new RpcError(`${method}: ${body.error.message}`, body.error.code, body.error.data);
        }
        return body.result as T;
      } catch (e) {
        if (e instanceof RpcError && e.code !== undefined) throw e;
        lastErr = e;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  /** getMultipleAccounts (jsonParsed) returning the context slot with the values. */
  async accounts(pubkeys: string[], encoding = "jsonParsed"): Promise<{ slot: number; values: any[] }> {
    const out: any[] = [];
    let slot = 0;
    for (let i = 0; i < pubkeys.length; i += 100) {
      const r = await this.call("getMultipleAccounts", [
        pubkeys.slice(i, i + 100),
        { encoding, commitment: this.commitment },
      ]);
      slot = Math.max(slot, r.context.slot);
      out.push(...r.value);
    }
    return { slot, values: out };
  }

  async account(pubkey: string, encoding = "jsonParsed"): Promise<{ slot: number; value: any }> {
    const r = await this.call("getAccountInfo", [pubkey, { encoding, commitment: this.commitment }]);
    return { slot: r.context.slot, value: r.value };
  }

  async epochInfo(): Promise<{ epoch: number; absoluteSlot: number; slotIndex: number; slotsInEpoch: number }> {
    return this.call("getEpochInfo", [{ commitment: this.commitment }]);
  }

  async slot(): Promise<number> {
    return this.call("getSlot", [{ commitment: this.commitment }]);
  }

  async blockTime(slot: number): Promise<number | null> {
    return this.call("getBlockTime", [slot]);
  }

  async transaction(signature: string): Promise<any> {
    return this.call("getTransaction", [
      signature,
      { encoding: "jsonParsed", commitment: this.commitment, maxSupportedTransactionVersion: 0 },
    ]);
  }

  async signaturesFor(address: string, opts: Record<string, unknown> = {}): Promise<any[]> {
    return this.call("getSignaturesForAddress", [address, { commitment: this.commitment, ...opts }]);
  }
}
