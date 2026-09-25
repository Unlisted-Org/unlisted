"use client";
// Client entry for the holder app. Logic ported from Agent B's app (app/src); the config is read at
// runtime from /config.json, and anything but devnet or localnet is refused.
import "./polyfills";
import { useEffect, useState } from "react";
import { App } from "./App";
import { AppConfig, loadConfig } from "./config";

export default function Root() {
  const [cfg, setCfg] = useState<AppConfig | { error: string } | null>(null);
  useEffect(() => { loadConfig().then(setCfg); }, []);
  if (!cfg) return <p className="muted" data-testid="app-loading">Loading config…</p>;
  if ("error" in cfg) return <div className="banner alert" data-testid="config-error">{cfg.error}</div>;
  return <App config={cfg} />;
}
