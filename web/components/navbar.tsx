import Link from "next/link";
import { Logo } from "./logo";
import { Container } from "./container";
import { Button } from "./ui/button";
import { ModeToggle } from "./mode-toggle";
import { REPO } from "@/lib/evidence";

const LINKS = [
  { title: "What happened", href: "/#happened" },
  { title: "How it survives", href: "/#survive" },
  { title: "Signatures", href: "/#proof" },
  { title: "Cost", href: "/#cost" },
  { title: "Disclosures", href: "/#disclosures" },
];

export const Navbar = () => (
  <header className="border-b border-line">
    <Container className="flex items-center justify-between gap-4 py-3">
      <Logo />
      <nav aria-label="Sections" className="hidden items-center gap-7 lg:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-[13px] font-medium text-ink-muted hover:text-ink">
            {l.title}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <a href={REPO} className="hidden text-[13px] font-medium text-ink-muted hover:text-ink sm:inline">GitHub</a>
        <ModeToggle />
        <Button asChild size="sm">
          <Link href="/app">Open app</Link>
        </Button>
      </div>
    </Container>
    <nav aria-label="Sections" className="flex gap-5 overflow-x-auto border-t border-line px-4 py-2 lg:hidden">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="shrink-0 text-[13px] font-medium text-ink-muted">
          {l.title}
        </Link>
      ))}
    </nav>
  </header>
);
