import Link from "next/link";
import { Container } from "../container";
import { Button } from "../ui/button";
import { Receipt } from "./receipt";
import { TiltOnScroll } from "./tilt";
import { evidence } from "@/lib/evidence";
import { Sig } from "./sig";

export function Hero() {
  const redeem = evidence.browser.steps.find((s) => s.label.startsWith("Redeem"))!;
  return (
    <section className="relative overflow-hidden pt-12 md:pt-20 lg:pt-28" aria-labelledby="hero-title">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="flex flex-col gap-7">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted">Seven tokenized pre-IPO companies · one basket</p>
          <h1 id="hero-title" className="font-display text-[34px] font-semibold leading-[1.06] tracking-[-0.015em] md:text-5xl lg:text-[56px]">
            Tokenized pre-IPO shares come with an issuer who can pause them, seize them, and triple what it costs to move them.
          </h1>
          <p className="max-w-xl text-base text-ink-muted md:text-lg">
            All three have already happened. Unlisted is a basket of seven that keeps paying you out when the issuer acts.
            Every claim on this page links to a transaction you can check.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild className="shadow-brand">
              <Link href="#proof">See the signatures</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app">Open the app (devnet)</Link>
            </Button>
          </div>
          <p className="text-[13px] text-ink-muted">
            Runs on Solana devnet against mirrors of the real mints. Not endorsed by PreStocks.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <TiltOnScroll>
            <Receipt />
          </TiltOnScroll>
          <p className="text-[12px] text-ink-muted">
            A real redemption from a fresh wallet: <Sig signature={redeem.signature} network={redeem.network} short />
          </p>
        </div>
      </Container>
    </section>
  );
}
