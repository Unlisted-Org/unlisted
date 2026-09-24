// Off-chain and mainnet market sources. Every figure returned carries where and when it was read.

import { MAINNET_USDC } from "./token2022.ts";

const JUP_PRICE = process.env.JUP_PRICE_URL ?? "https://lite-api.jup.ag/price/v3";
const JUP_BUILD = process.env.JUP_BUILD_URL ?? "https://api.jup.ag/swap/v2/build";
const PRESTOCKS = process.env.PRESTOCKS_URL ?? "https://prestocks.com/api/prestocks";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

async function getJson(url: string, tries = 4): Promise<any> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (process.env.JUP_API_KEY && url.includes("jup.ag")) headers["x-api-key"] = process.env.JUP_API_KEY;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`${url} HTTP ${r.status}`);
      const body = await r.json();
      if (!r.ok) throw Object.assign(new Error(`${url} HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`), { status: r.status, body });
      return body;
    } catch (e: any) {
      last = e;
      if (e?.status && e.status < 500 && e.status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

export interface LastTrade {
  mint: string;
  usd_per_ui: number; // Jupiter usdPrice (per scaled UI token)
  usd_per_unscaled_token: number; // usdPricePrescaled, or usdPrice when the mint has no multiplier config
  usd_per_raw: number; // usd_per_unscaled_token / 10^decimals
  block: number; // blockId of the last swap
  liquidity_usd: number;
  decimals: number;
  fetched_at: string;
  source: string;
  raw: any;
}

/** Jupiter price v3: last swapped price. `usdPricePrescaled` is per unscaled token (raw / 10^decimals). */
export async function jupiterLastTrade(mints: string[]): Promise<Record<string, LastTrade>> {
  const body = await getJson(`${JUP_PRICE}?ids=${mints.join(",")}`);
  const fetched_at = nowIso();
  const out: Record<string, LastTrade> = {};
  for (const m of mints) {
    const p = body[m];
    if (!p) continue;
    const prescaled = p.scaledUiConfig?.usdPricePrescaled ?? p.usdPrice;
    out[m] = {
      mint: m,
      usd_per_ui: p.usdPrice,
      usd_per_unscaled_token: prescaled,
      usd_per_raw: prescaled / 10 ** p.decimals,
      block: p.blockId,
      liquidity_usd: p.liquidity,
      decimals: p.decimals,
      fetched_at,
      source: "jupiter price v3 usdPricePrescaled (mainnet)",
      raw: p,
    };
  }
  return out;
}

export interface Mark {
  mint: string;
  symbol: string;
  mark_price_usd_per_ui: number;
  fetched_at: string;
  source: string;
}

/** PreStocks markPrice: USD per UI token, off-chain estimate, no timestamp in the response. */
export async function prestocksMarks(): Promise<Record<string, Mark>> {
  const body = await getJson(PRESTOCKS);
  const fetched_at = nowIso();
  const out: Record<string, Mark> = {};
  for (const x of body) {
    out[x.contract_address] = { mint: x.contract_address, symbol: x.symbol, mark_price_usd_per_ui: Number(x.markPrice), fetched_at, source: "prestocks.com/api/prestocks markPrice" };
  }
  return out;
}

export interface SellQuote {
  mint: string;
  in_amount_raw: string;
  out_usdc_raw: string;
  route: string;
  price_impact_bps: number;
  build: any; // the full /build response: instructions + lookup tables, used to simulate the same route
  quoted_at: string;
  source: string;
  taker: string;
}

/**
 * Fee-inclusive sell quote of `amountRaw` of a mainnet mint into USDC through Jupiter swap v2 /build,
 * with Manifest excluded (its quotes ignore the transfer fee: Bonasa-Tech/manifest#735).
 * `taker` must hold the input on mainnet if the route is to be simulated.
 */
export async function jupiterSellQuote(mint: string, amountRaw: bigint, taker: string): Promise<SellQuote> {
  const q = new URLSearchParams({
    inputMint: mint,
    outputMint: MAINNET_USDC,
    amount: amountRaw.toString(),
    slippageBps: "100",
    excludeDexes: "Manifest",
    maxAccounts: "30",
    taker,
  });
  const b = await getJson(`${JUP_BUILD}?${q}`);
  return {
    mint,
    in_amount_raw: String(b.inAmount),
    out_usdc_raw: String(b.outAmount),
    route: [...new Set((b.routePlan ?? []).map((r: any) => r.swapInfo?.label))].join(" + "),
    // priceImpactPct is a percentage (a $2k OPENAI sell reads ~0.023, i.e. ~2 bps, against ~$0.9M liquidity).
    price_impact_bps: Math.round(Number(b.priceImpactPct ?? 0) * 100),
    build: b,
    quoted_at: nowIso(),
    source: "jupiter swap/v2 build excludeDexes=Manifest (mainnet)",
    taker,
  };
}
