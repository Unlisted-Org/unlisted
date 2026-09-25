import { evidence } from "@/lib/evidence";
import { int, slot } from "@/lib/format";

const LEGS = ["OPENAI", "ANTHROPIC", "NEURALINK", "ANDURIL", "POLYMARKET", "KALSHI", "FIGUREAI"];

/**
 * The real redemption from the browser run by a fresh wallet on devnet: ANTHROPIC paused by the
 * issuer, six legs paid immediately, ANTHROPIC became a claim, and the claim settled after resume.
 * Every number comes from app/e2e/runs/2026-09-24-devnet.json.
 */
export function Receipt() {
  const b = evidence.browser;
  const redeem = b.steps.find((s) => s.label.startsWith("Redeem"))!;
  const settle = b.steps.find((s) => s.label.startsWith("Settle"))!;
  return (
    <div
      data-testid="receipt"
      className="w-full rounded-lg border border-line bg-surface text-[12px] text-ink shadow-xl dark:shadow-none"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-col">
          <span className="font-display text-[15px] font-semibold">Redemption while ANTHROPIC is paused</span>
          <span className="font-mono text-[11px] text-ink-muted">devnet · slot {slot(redeem.slot)} · fresh wallet</span>
        </div>
        <span className="rounded-sm bg-issuer-soft px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-issuer">issuer paused 1 leg</span>
      </div>
      <table className="w-full tabular">
        <tbody>
          {LEGS.map((leg) => {
            const paid = b.paidNow[leg];
            return (
              <tr key={leg} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-medium">{leg}</td>
                <td className="px-4 py-2">
                  {paid ? (
                    <span className="rounded-sm bg-paid-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paid">paid now</span>
                  ) : (
                    <span className="rounded-sm bg-claim-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-claim">claim</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono">{paid ? int(paid) : `${int(b.claim.units)} units`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-ground px-4 py-3 font-mono text-[11px]">
        <span className="text-paid">ANTHROPIC resumed → claim settled: {int(b.settled.received)} received</span>
        <span className="text-ink-muted">slot {slot(settle.slot)}</span>
      </div>
    </div>
  );
}
