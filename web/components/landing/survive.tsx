import { Container } from "../container";
import { evidence, explorerTx } from "@/lib/evidence";
import Link from "next/link";
import { StepsBeam } from "./steps-beam";

const RULES = [
  "The issuer pauses one of the seven tokens. Nothing else in the basket changes.",
  "A redemption pays every leg the issuer didn't touch, immediately. The paused leg becomes a claim, which keeps sharing that token's gains and losses until it pays.",
  "The issuer lifts the pause.",
  "Anyone can settle the claim; it doesn't need the holder. It pays out the claim's share of that token as held at settlement.",
];

export function Survive() {
  const steps = evidence.survive;
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
                <a className="self-start text-[13px] text-paid underline underline-offset-2" href={explorerTx(s.signature, s.network)} target="_blank" rel="noreferrer" data-signature={s.signature} data-network={s.network}>
                  View the transaction
                </a>
              </div>
            </li>
          ))}
        </ol>
        </StepsBeam>
      </Container>
      <Container className="mt-10">
        <p className="max-w-3xl text-[15px] text-ink-muted">
          <b className="text-ink">A seizure</b> is handled the same way: the vault's real balance is the truth, the loss is
          recorded on chain, and every holder shares it pro rata.{" "}
          <b className="text-ink">No oracle:</b> deposits and redemptions are computed from what the vault holds.{" "}
          <Link className="text-paid underline underline-offset-2" href="/evidence#devnet">Every step, slot and scenario on the evidence page</Link>.
        </p>
      </Container>
    </section>
  );
}
