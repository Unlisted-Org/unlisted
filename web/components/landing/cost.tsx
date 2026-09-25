import { Container } from "../container";
import { recordUrl } from "@/lib/evidence";

// docs/risks.md §1: fees are 1 − 0.97² at 300 bps; spread measured on 2026-09-24.
const ROWS = [
  { size: "$10,000", spread: "≈ 2.0%", total: "≈ 7.9%" },
  { size: "$1,000", spread: "≈ 1.3%", total: "≈ 7.2%" },
  { size: "$10", spread: "≈ 0.5%", total: "≈ 6.5%" },
];

export function Cost() {
  return (
    <section id="cost" className="border-t border-line bg-ground py-16 md:py-24" aria-labelledby="cost-title">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="flex flex-col gap-5">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-claim">What it costs, and what we don&apos;t claim</p>
          <h2 id="cost-title" className="font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
            About 7.9% for a $10,000 round trip
          </h2>
          <p className="text-base text-ink-muted md:text-lg">
            Putting money into Unlisted and taking it out is never cheaper than buying the seven tokens yourself. Every
            token pays PreStocks' 300 bps transfer fee on the way in and again on the way out, and the market spread comes
            on top.
          </p>
          <p className="text-[14px] text-ink-muted">
            What you get for it: one token instead of seven, and a basket that keeps paying out when the issuer acts.
            Transfers of the Unlisted token itself pay no PreStocks fee.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[420px] text-left text-[14px] tabular">
              <caption className="sr-only">Estimated round-trip cost at a 300 bps transfer fee, by size</caption>
              <thead className="bg-ground font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-normal">Round trip of</th>
                  <th className="px-4 py-3 text-right font-normal">Fees</th>
                  <th className="px-4 py-3 text-right font-normal">Spread</th>
                  <th className="px-4 py-3 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.size} className="border-t border-line">
                    <td className="px-4 py-3 font-medium">{r.size}</td>
                    <td className="px-4 py-3 text-right font-mono">5.91%</td>
                    <td className="px-4 py-3 text-right font-mono">{r.spread}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-claim">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-ink-muted">
            Fees: 1 − 0.97² = 5.91% at 300 bps, exact. Spread: measured on 24 Sep 2026 and to be re-measured under the new
            fee, so the totals are estimates. <a className="underline" href={recordUrl("docs/risks.md")}>Workings</a> ·{" "}
            <a className="underline" href="/evidence">Evidence</a>
          </p>
        </div>
      </Container>
    </section>
  );
}
