import { Container } from "./container";
import { Logo } from "./logo";
import { REPO, recordUrl } from "@/lib/evidence";

export const Footer = () => (
  <footer className="border-t border-line bg-ground">
    <Container className="flex flex-col gap-8 py-12 md:flex-row md:items-start md:justify-between">
      <div className="flex max-w-sm flex-col gap-3">
        <Logo />
        <p className="text-[13px] text-ink-muted">
          A basket of seven tokenized pre-IPO companies that keeps paying out when the issuer acts. Devnet only.
          PreStocks has no objection to it; that is not an endorsement. Nothing here is investment advice.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-8 text-[13px]">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Evidence</span>
          <a className="hover:underline" href={recordUrl("docs/risks.md")}>Issuer record and risks</a>
          <a className="hover:underline" href={recordUrl("evidence/symmetry-fork/README.md")}>Symmetry on a fork</a>
          <a className="hover:underline" href={recordUrl("docs/specs/01-shares-and-pricing.md")}>Share maths</a>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">Project</span>
          <a className="hover:underline" href={REPO}>GitHub</a>
          <a className="hover:underline" href="/app">App (devnet)</a>
        </div>
      </div>
    </Container>
  </footer>
);
