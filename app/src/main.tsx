import "./polyfills";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppConfig, loadConfig } from "./config";
import "./styles.css";

function Root() {
  const [cfg, setCfg] = useState<AppConfig | { error: string } | null>(null);
  useEffect(() => { loadConfig().then(setCfg); }, []);
  if (!cfg) return <div className="page"><p className="muted">Loading config…</p></div>;
  if ("error" in cfg) return <div className="page"><h1>Unlisted basket</h1><div className="banner alert" data-testid="config-error">{cfg.error}</div></div>;
  return <App config={cfg} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
