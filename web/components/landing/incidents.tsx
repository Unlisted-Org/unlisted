import { Container } from "../container";
import { evidence } from "@/lib/evidence";
import { NetBadge } from "./sig";
import { explorerTx } from "@/lib/evidence";
import Link from "next/link";
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

function TxLink({ signature, network, label = "View the transaction" }: { signature: string; network: "devnet" | "mainnet"; label?: string }) {
  return (
    <a className="text-paid underline underline-offset-2" href={explorerTx(signature, network)} target="_blank" rel="noreferrer" data-signature={signature} data-network={network}>
      {label}
    </a>
  );
}

export function Incidents() {
  const openai = evidence.multiplier.find((m) => m.mint === "OPENAI")!;
  const openaiFee = evidence.feeChanges.find((f) => f.mint === "OPENAI")!;
  return (
    <section id="happened" className="py-16 md:py-20" aria-labelledby="happened-title">
      <Container className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-issuer">The problem</p>
          <h2 id="happened-title" className="max-w-3xl font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
            These tokens come with an issuer who can pause, seize and re-price them
          </h2>
          <p className="max-w-2xl text-base text-ink-muted md:text-lg">
            One multisig, two signatures needed, no time lock. It has used those powers, on mainnet:
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card
            kicker="Seizure · 19 Sep 2025"
            title="29 holder accounts emptied"
            footer={<><span>Every token moved out of other people's accounts, with no explanation.</span><TxLink {...evidence.seizureMainnet[0]} /></>}
          >
            <table className="w-full font-mono text-[12px] tabular" aria-label="Tokens taken, by mint">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
                  <th className="pb-2 font-normal">Mint</th>
                  <th className="pb-2 text-right font-normal">Taken</th>
                  <th className="pb-2 text-right font-normal">Left</th>
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
            title="Three fee changes in sixteen days"
            footer={<><span>0 → 50 → 100 → 300 bps, each with about a day and a half of notice.</span><TxLink {...openaiFee} label="View the 300 bps change (OpenAI)" /></>}
          >
            <FeeSteps />
          </Card>
          <Card
            kicker="Display multiplier · 17 Jul 2026"
            title="Nine minutes' notice on OpenAI"
            footer={<><span>Signed {openai.signed} UTC, in force {openai.effective} UTC.</span><TxLink signature={openai.signature} network={openai.network} /></>}
          >
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">Warning given</span>
              <span className="font-display text-6xl font-semibold tabular md:text-7xl" aria-label="9 minutes 41 seconds">9:41</span>
              <span className="font-mono text-[12px] text-ink-muted">OPENAI × {openai.multiplier} · <NetBadge network="mainnet" /></span>
            </div>
          </Card>
        </div>
        <p className="text-[13px] text-ink-muted">
          Every transaction, including all seven fee changes and the second multiplier change:{" "}
          <Link className="text-paid underline underline-offset-2" href="/evidence#mainnet">the evidence page</Link>.
        </p>
      </Container>
    </section>
  );
}
