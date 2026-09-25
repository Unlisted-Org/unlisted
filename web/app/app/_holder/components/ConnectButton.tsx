// One Connect Wallet button. It opens the Solana wallet adapter's modal, which lists the wallets this
// browser actually has (Wallet Standard detection). Once connected it shows the address and a small menu.
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

const BTN = "inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium";

export function ConnectButton() {
  const { publicKey, wallet, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!publicKey) {
    return (
      <button type="button" onClick={() => setVisible(true)} disabled={connecting} data-testid="connect-wallet" className={`${BTN} bg-primary text-primary-foreground disabled:opacity-60`}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  const addr = publicKey.toBase58();
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="wallet-connected" data-wallet={wallet?.adapter.name}
        className={`${BTN} border border-line bg-surface text-ink hover:bg-ground`}>
        {wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="" className="size-4 rounded-sm" />}
        <span className="font-mono text-[12px]" data-testid="wallet-address" data-address={addr} title={addr}>{addr.slice(0, 4)}…{addr.slice(-4)}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-30 w-56 rounded-md border border-line bg-surface p-1 text-[13px] shadow-lg">
          <div className="px-3 py-2 text-ink-muted">{wallet?.adapter.name}</div>
          <MenuItem onClick={() => { navigator.clipboard?.writeText(addr).then(() => setCopied(true)); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy address"}</MenuItem>
          <MenuItem onClick={() => { setOpen(false); setVisible(true); }}>Change wallet</MenuItem>
          <MenuItem onClick={() => { setOpen(false); disconnect(); }} testid="wallet-disconnect">Disconnect</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, testid }: { children: React.ReactNode; onClick: () => void; testid?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testid} className="block w-full rounded px-3 py-2 text-left text-ink hover:bg-ground">
      {children}
    </button>
  );
}
