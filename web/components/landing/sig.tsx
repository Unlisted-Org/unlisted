import { explorerTx, type Network } from "@/lib/evidence";
import { cn } from "@/lib/utils";

/** A transaction signature, in full, selectable, linked to the explorer on its network. */
export function Sig({ signature, network, className, short = false }: { signature: string; network: Network; className?: string; short?: boolean }) {
  return (
    <a
      href={explorerTx(signature, network)}
      target="_blank"
      rel="noreferrer"
      data-signature={signature}
      data-network={network}
      className={cn(
        "font-mono text-[12px] leading-snug break-all text-paid underline decoration-paid/30 underline-offset-2 hover:decoration-paid",
        className,
      )}
      title={`${signature} on ${network}`}
    >
      {short ? `${signature.slice(0, 8)}…${signature.slice(-8)}` : signature}
    </a>
  );
}

export function NetBadge({ network }: { network: Network }) {
  return (
    <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
      {network}
    </span>
  );
}
