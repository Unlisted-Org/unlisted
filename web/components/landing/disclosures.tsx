import { Container } from "../container";
import { recordUrl } from "@/lib/evidence";

const ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "OpenAI and Anthropic say the underlying share transfers are void",
    a: (
      <>
        <p>
          Two of the seven companies in Unlisted, OpenAI and Anthropic, have said publicly that transfers of their shares to
          special purpose vehicles are void. Anthropic says third parties selling its shares through tokenized securities are
          &ldquo;likely offering an investment that may have no value&rdquo;.
        </p>
        <p>
          PreStocks tokens give no claim on any company, SPV or PreStocks itself. Their value depends on PreStocks' own
          undisclosed arrangements, which PreStocks' terms say may be reduced or eliminated. Unlisted holds these tokens as
          they are, at equal weight with the other five, and cannot change that. At inception these two names are about 2/7
          (≈ 29%) of the basket's value.
        </p>
      </>
    ),
  },
  {
    q: "PreStocks hasn't endorsed this",
    a: (
      <p>
        We have asked PreStocks for a written acknowledgement and have had no reply. Their Terms appear to permit wrapping
        and pooling without their consent, so we proceed on that basis. No fee is routed to PreStocks beyond the transfer fee
        every token already pays.
      </p>
    ),
  },
  {
    q: "It runs on devnet only",
    a: (
      <p>
        The program and app run on Solana devnet, against fixture tokens that mirror the seven real mints extension for
        extension (the differences are published). Nothing here holds real PreStocks tokens or real money.
      </p>
    ),
  },
  {
    q: "It doesn't protect you from the issuer",
    a: (
      <p>
        The issuer can still pause, seize, freeze and change fees. Unlisted doesn't stop any of it. What it changes is how the
        basket fails: one name at a time, with the rest still paid out, instead of all at once.
      </p>
    ),
  },
];

export function Disclosures() {
  return (
    <section id="disclosures" className="bg-ground pb-16 md:pb-24" aria-labelledby="disclosures-title">
      <Container className="grid grid-cols-1 [&>*]:min-w-0 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <h2 id="disclosures-title" className="font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
            What we don&apos;t claim
          </h2>
          <p className="text-base text-ink-muted">
            Read these before anything else on this page. <a className="underline" href={recordUrl("docs/risks.md")}>Sources</a>
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {ITEMS.map((it) => (
            <details key={it.q} open className="group rounded-lg border border-line bg-surface p-5 open:pb-6">
              <summary className="cursor-pointer list-none font-display text-lg font-semibold marker:content-none">
                <span className="flex items-start justify-between gap-4">
                  {it.q}
                  <span aria-hidden className="font-mono text-ink-muted group-open:rotate-45 transition-transform">+</span>
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-ink-muted">{it.a}</div>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
