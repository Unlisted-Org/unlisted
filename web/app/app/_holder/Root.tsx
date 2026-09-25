"use client";
// Client entry for the holder app: the runtime config (from /config.json; anything but devnet or
// localnet is refused), the Solana wallet adapter, and the shared holder state, around every route.
import "./polyfills";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { WalletError } from "@solana/wallet-adapter-base";
import { AppShell } from "../shell";
import { AppConfig, loadConfig } from "./config";
import { HolderProvider, useHolder } from "./context";
import { ConnectButton } from "./components/ConnectButton";
import { claimsOf } from "./components/Panels";

export default function Root({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<AppConfig | { error: string } | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  useEffect(() => { loadConfig().then(setCfg); }, []);
  // Wallet Standard wallets are detected automatically; no wallet-specific adapters are bundled.
  const wallets = useMemo(() => [], []);
  if (!cfg) return <AppShell><p className="muted" data-testid="app-loading">Loading config…</p></AppShell>;
  if ("error" in cfg) return <AppShell><div className="banner alert" data-testid="config-error">{cfg.error}</div></AppShell>;
  const notice = walletErr ? <div className="banner alert mb-4" data-testid="connect-error">{walletErr}</div> : null;
  return (
    <ConnectionProvider endpoint={cfg.rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect onError={(e: WalletError) => setWalletErr(e.message || e.name)}>
        <WalletModalProvider className="unlisted-wallet-modal">
          <HolderProvider config={cfg}>
            <Frame notice={notice}>{children}</Frame>
          </HolderProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Frame({ children, notice }: { children: ReactNode; notice: ReactNode }) {
  const h = useHolder();
  // Preload the other routes' code, so navigating never waits on a fetch.
  useEffect(() => { const t = setTimeout(() => { import("../views").then((v) => v.loadRoutes()).catch(() => {}); }, 1500); return () => clearTimeout(t); }, []);
  const claims = claimsOf(h.pos).length;
  const badge = claims ? <span className="rounded-sm bg-claim-soft px-1.5 font-mono text-[10px] text-claim" data-testid="nav-claims-count">{claims}</span> : null;
  return <AppShell wallet={<ConnectButton />} badges={{ "/app/claims": badge }} notice={notice}>{children}</AppShell>;
}
