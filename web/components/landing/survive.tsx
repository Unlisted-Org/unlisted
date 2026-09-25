import { Container } from "../container";
import { evidence, recordUrl } from "@/lib/evidence";
import { slot } from "@/lib/format";
import { Sig } from "./sig";
import { StepsBeam } from "./steps-beam";

const RULES = [
  "The issuer pauses one of the seven tokens. Nothing else in the basket changes.",
  "A redemption pays every leg the issuer didn't touch, immediately. The paused leg becomes a claim, which keeps sharing that token's gains and losses until it pays.",
  "The issuer lifts the pause.",
  "Anyone can settle the claim; it doesn't need the holder. It pays out the claim's share of that token as held at settlement.",
];

export function Survive() {
  const steps = evidence.survive;
  const [seize, observe] = evidence.seizure;
  return (
    <section id="survive" className="py-16 md:py-24 lg:py-28" aria-labelledby="survive-title">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col gap-5 lg:sticky lg:top-8 lg:self-start">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-paid">How Unlisted survives it</p>
          <h2 id="survive-title" className="font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
            This one pays you out anyway
          </h2>
          <p className="text-base text-ink-muted md:text-lg">
            The same pause, on Unlisted's program on Solana devnet. Each step below is a finalized transaction.
          </p>
          <a className="text-[13px] text-paid underline underline-offset-2" href={recordUrl(steps[0].record)}>
            Full scenario record
          </a>
        </div>
        <StepsBeam>
        <ol className="relative flex flex-col" aria-label="Pause, redeem, resume, settle">
          <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-line" />
          {steps.map((s, i) => (
            <li key={s.signature} className="relative grid grid-cols-[32px_1fr] gap-4 pb-8 last:pb-0">
              <span className={`z-10 flex size-8 items-center justify-center rounded-full border font-mono text-[12px] ${i === 0 ? "border-issuer bg-issuer-soft text-issuer" : "border-paid bg-paid-soft text-paid"}`}>
                {i + 1}
              </span>
              <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
                <h3 className="font-display text-lg font-semibold">{s.label}</h3>
                <p className="text-[14px] text-ink-muted">{RULES[i]}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Sig signature={s.signature} network={s.network} />
                </div>
                <span className="font-mono text-[11px] text-ink-muted">devnet · slot {slot(s.slot)}</span>
              </div>
            </li>
          ))}
        </ol>
        </StepsBeam>
      </Container>
      <Container className="mt-12 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5">
          <h3 className="font-display text-lg font-semibold">A seizure is seen and shared, not hidden</h3>
          <p className="text-[14px] text-ink-muted">
            The vault's actual balance is the truth, never a recorded number. When the issuer takes tokens out, anyone can
            record the shortfall, and every holder bears it pro rata. No later depositor makes anyone whole.
          </p>
          <Sig signature={seize.signature} network={seize.network} short />
          <Sig signature={observe.signature} network={observe.network} short />
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5">
          <h3 className="font-display text-lg font-semibold">No oracle</h3>
          <p className="text-[14px] text-ink-muted">
            Deposits and redemptions are computed from the vault's holdings alone. The app shows three labelled values
            (what you'd get selling now, the last trade, and PreStocks' own reference) with their ages and the gaps
            between them. It never shows a single "price".
          </p>
        </div>
      </Container>
    </section>
  );
}
