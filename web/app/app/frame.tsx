"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AppShell } from "./shell";

// The holder app runs only in the browser (wallets, chain reads); the frame renders while it loads.
const Root = dynamic(() => import("./_holder/Root"), {
  ssr: false,
  loading: () => <AppShell><p className="muted" data-testid="app-loading">Loading the basket…</p></AppShell>,
});

export function Frame({ children }: { children: ReactNode }) {
  return <Root>{children}</Root>;
}
