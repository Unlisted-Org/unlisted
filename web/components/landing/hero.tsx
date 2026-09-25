import Link from "next/link";
import { Container } from "../container";
import { Button } from "../ui/button";
import { Receipt } from "./receipt";
import { TiltOnScroll } from "./tilt";
import { evidence, explorerTx } from "@/lib/evidence";

export const COMPANIES = ["OpenAI", "Anthropic", "Neuralink", "Anduril", "Polymarket", "Kalshi", "FigureAI"];

export function Hero() {
  const redeem = evidence.browser.steps.find((s) => s.label.startsWith("Redeem"))!;
  return (
    <section className="relative overflow-hidden pt-12 md:pt-20 lg:pt-24" aria-labelledby="hero-title">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="flex flex-col gap-7">
          <h1 id="hero-title" className="font-display text-[36px] font-semibold leading-[1.05] tracking-[-0.015em] md:text-5xl lg:text-[58px]">
            Seven pre-IPO companies. One token. You can always get your share out.
          </h1>
          <ul className="flex flex-wrap gap-2" aria-label="The seven companies" data-testid="companies">
            {COMPANIES.map((c) => (
              <li key={c} className="rounded-md border border-line bg-surface px-3 py-1.5 font-display text-[15px] font-semibold">
                {c}
              </li>
            ))}
          </ul>
          <p className="max-w-xl text-base text-ink-muted md:text-lg">
            Unlisted holds tokenized shares of all seven at equal weight and gives you one token for the lot. If the
            issuer behind those tokens pauses or seizes one of them, you still get the other six out at once, and the
            seventh when it's released.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="shadow-brand">
              <Link href="/app">Open the app (devnet)</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="#survive">How it survives the issuer</Link>
            </Button>
          </div>
          <p className="text-[13px] text-ink-muted">
            Runs on Solana devnet against mirrors of the real PreStocks tokens. Not endorsed by PreStocks or any of the seven companies.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <TiltOnScroll>
            <Receipt />
          </TiltOnScroll>
          <p className="text-[12px] text-ink-muted">
            A real redemption from a fresh wallet, with one of the seven paused:{" "}
            <a className="text-paid underline underline-offset-2" href={explorerTx(redeem.signature, redeem.network)} target="_blank" rel="noreferrer" data-signature={redeem.signature}>
              view the transaction
            </a>
          </p>
        </div>
      </Container>
    </section>
  );
}
