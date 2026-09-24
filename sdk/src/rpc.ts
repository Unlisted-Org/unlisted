// A fetch for web3.js Connection that is polite to rate-limited public RPCs (e.g. api.devnet.solana.com):
// - at most `concurrency` requests in flight and at least `minIntervalMs` between request starts,
//   so one client opens few connections;
// - on 429 / 502 / 503 / network errors, retries with exponential backoff and jitter
//   (honouring Retry-After), up to `maxRetries` times, before returning the last response or error.
// Use with `new Connection(url, { fetch: politeFetch(), disableRetryOnRateLimit: true })`.

export interface PoliteFetchOptions { concurrency?: number; minIntervalMs?: number; maxRetries?: number; maxDelayMs?: number; log?: (msg: string) => void }

type FetchLike = (input: any, init?: any) => Promise<Response>;

export function politeFetch(opts: PoliteFetchOptions = {}, base: FetchLike = (globalThis.fetch as any).bind(globalThis)): FetchLike {
  const concurrency = opts.concurrency ?? 2;
  const minInterval = opts.minIntervalMs ?? 150;
  const maxRetries = opts.maxRetries ?? 10;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  let inFlight = 0;
  let lastStart = 0;
  const waiters: (() => void)[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function acquire() {
    while (inFlight >= concurrency) await new Promise<void>((r) => waiters.push(r));
    inFlight++;
    const wait = lastStart + minInterval - Date.now();
    lastStart = Math.max(Date.now(), lastStart + minInterval);
    if (wait > 0) await sleep(wait);
  }
  function release() { inFlight--; waiters.shift()?.(); }

  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      await acquire();
      let res: Response | undefined;
      let err: unknown;
      try { res = await base(input, init); } catch (e) { err = e; } finally { release(); }
      const retryable = err !== undefined || (res && (res.status === 429 || res.status === 502 || res.status === 503));
      if (!retryable || attempt >= maxRetries) {
        if (err !== undefined) throw err;
        return res!;
      }
      const after = Number(res?.headers.get("retry-after"));
      const delay = Math.min(maxDelay, Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt) + Math.random() * 250;
      opts.log?.(`RPC ${res ? res.status : "network error"}; retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)} ms`);
      await sleep(delay);
    }
  };
}
