"use client";
// Route views, loaded in the browser only: they read the wallet and the chain through the holder state.
// A route's code is fetched on first visit; a stalled or failed fetch is retried (a rehearsal once saw
// the Claims route stay blank when its chunk request never completed), and the Overview preloads the rest.
import dynamic from "next/dynamic";

function retry<T>(load: () => Promise<T>, tries = 4): Promise<T> {
  const once = Promise.race([load(), new Promise<never>((_, no) => setTimeout(() => no(new Error("route code timed out")), 8_000))]);
  return once.catch((e) => (tries > 1 ? new Promise((r) => setTimeout(r, 600)).then(() => retry(load, tries - 1)) : Promise.reject(e)));
}
export const loadRoutes = () => retry(() => import("./_holder/views/Routes"));

const Loading = () => <p className="muted" data-testid="route-loading">Loading…</p>;
export const OverviewView = dynamic(() => retry(() => import("./_holder/views/Overview")).then((m) => m.Overview), { ssr: false, loading: Loading });
export const BuyView = dynamic(() => loadRoutes().then((m) => m.Buy), { ssr: false, loading: Loading });
export const SellView = dynamic(() => loadRoutes().then((m) => m.Sell), { ssr: false, loading: Loading });
export const ClaimsView = dynamic(() => loadRoutes().then((m) => m.Claims), { ssr: false, loading: Loading });
export const BasketView = dynamic(() => loadRoutes().then((m) => m.Basket), { ssr: false, loading: Loading });
export const HistoryView = dynamic(() => loadRoutes().then((m) => m.History), { ssr: false, loading: Loading });
