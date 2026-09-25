import { Container } from "../container";
import { evidence } from "@/lib/evidence";
import { Sig, NetBadge } from "./sig";
import { FeeSteps } from "./fee-steps";

const SEIZED = [
  { mint: "XAI", amount: "26.86" },
  { mint: "SPACEX", amount: "3.66" },
  { mint: "ANDURIL", amount: "1.75" },
  { mint: "OPENAI", amount: "0.69" },
  { mint: "ANTHROPIC", amount: "0.20" },
];

function Card({ kicker, title, children, footer }: { kicker: string; title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-neutral-50 dark:bg-neutral-900">
      <div className="flex min-h-56 flex-1 flex-col justify-center px-5 pt-6 md:px-7">{children}</div>
      <div className="flex flex-col gap-3 px-5 pb-6 pt-5 md:px-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-issuer">{kicker}</p>
        <h3 className="font-display text-xl font-semibold leading-tight md:text-2xl">{title}</h3>
        <div className="flex flex-col gap-1.5 text-[13px] text-ink-muted">{footer}</div>
      </div>
    </article>
  );
}

export function Incidents() {
  const openai = evidence.multiplier.find((m) => m.mint === "OPENAI")!;
  return (
    <section id="happened" className="py-16 md:py-24 lg:py-28" aria-labelledby="happened-title">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <h2 id="happened-title" className="max-w-2xl font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
            It has already happened, on chain
          </h2>
          <p className="max-w-xl text-base text-ink-muted md:text-lg">
            The issuer's powers sit behind a 2-of-7 multisig with no time lock. These are its own transactions on Solana mainnet.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card
            kicker="Seizure · 19 Sep 2025"
            title="29 holder accounts emptied, with no explanation"
            footer={
              <>
                <span>The permanent delegate moved every token out of other people's accounts. Two of the seven transactions:</span>
                {evidence.seizureMainnet.map((s) => (
                  <Sig key={s.signature} signature={s.signature} network={s.network} short />
                ))}
              </>
            }
          >
            <table className="w-full font-mono text-[12px] tabular" aria-label="Tokens taken, by mint">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
                  <th className="pb-2 font-normal">Mint</th>
                  <th className="pb-2 text-right font-normal">Taken</th>
                  <th className="pb-2 text-right font-normal">Left in the accounts</th>
                </tr>
              </thead>
              <tbody>
                {SEIZED.map((r) => (
                  <tr key={r.mint} className="border-t border-line">
                    <td className="py-1.5">{r.mint}</td>
                    <td className="py-1.5 text-right text-issuer">−{r.amount}</td>
                    <td className="py-1.5 text-right">0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card
            kicker="Fees · 8 to 24 Sep 2026"
            title="Three fee changes in sixteen days, up to 300 bps"
            footer={
              <>
                <span>Each change came with about 35 to 38 hours' notice, the minimum Token-2022 allows. We found no announcement for the last two.</span>
                <details className="group">
                  <summary className="cursor-pointer text-ink">The 300 bps change: 7 transactions, one per mint</summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {evidence.feeChanges.map((f) => (
                      <li key={f.signature} className="flex flex-col">
                        <span className="font-mono text-[11px] text-ink">{f.mint}</span>
                        <Sig signature={f.signature} network={f.network} short />
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            }
          >
            <FeeSteps />
          </Card>
          <Card
            kicker="Display multiplier · 17 Jul 2026"
            title="OpenAI's multiplier changed with under ten minutes' warning"
            footer={
              <>
                <span>
                  Signed {openai.signed} UTC, in force {openai.effective} UTC. It changes what wallets display, not what the
                  tokens are. Unlisted never reads it.
                </span>
                <Sig signature={openai.signature} network={openai.network} short />
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Warning given</span>
              <span className="font-display text-6xl font-semibold tabular md:text-7xl" aria-label="9 minutes 41 seconds">
                9:41
              </span>
              <span className="font-mono text-[12px] text-ink-muted">
                OPENAI × {openai.multiplier} · <NetBadge network="mainnet" />
              </span>
            </div>
          </Card>
        </div>
      </Container>
    </section>
  );
}
