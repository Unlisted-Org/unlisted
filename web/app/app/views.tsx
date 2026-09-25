"use client";
// Route views, loaded in the browser only: they read the wallet and the chain through the holder state.
import dynamic from "next/dynamic";

export const OverviewView = dynamic(() => import("./_holder/views/Overview").then((m) => m.Overview), { ssr: false, loading: () => null });
export const BuyView = dynamic(() => import("./_holder/views/Routes").then((m) => m.Buy), { ssr: false, loading: () => null });
export const SellView = dynamic(() => import("./_holder/views/Routes").then((m) => m.Sell), { ssr: false, loading: () => null });
export const ClaimsView = dynamic(() => import("./_holder/views/Routes").then((m) => m.Claims), { ssr: false, loading: () => null });
export const BasketView = dynamic(() => import("./_holder/views/Routes").then((m) => m.Basket), { ssr: false, loading: () => null });
export const HistoryView = dynamic(() => import("./_holder/views/Routes").then((m) => m.History), { ssr: false, loading: () => null });
