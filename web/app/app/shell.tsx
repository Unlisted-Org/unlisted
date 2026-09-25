import Link from "next/link";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";

const NAV = [
  { href: "#overview", label: "Value" },
  { href: "#legs", label: "Legs" },
  { href: "#deposit", label: "Deposit" },
  { href: "#redeem", label: "Redeem" },
  { href: "#claims", label: "Claims" },
  { href: "#activity", label: "Activity" },
  { href: "#issuer", label: "Issuer events" },
  { href: "#disclosures", label: "Disclosures" },
];

/** The app frame, from the Nodus dashboard layout: a static sidebar and a dense main column. No motion. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="holder min-h-screen bg-ground">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="rounded-sm border border-claim/40 bg-claim-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-claim">devnet</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="hidden text-[13px] text-ink-muted hover:text-ink sm:inline">About Unlisted</Link>
          <ModeToggle />
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="App sections" className="border-b border-line bg-surface px-3 py-2 lg:sticky lg:top-[49px] lg:h-[calc(100vh-49px)] lg:border-b-0 lg:border-r lg:py-4">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col" style={{ paddingLeft: 0, margin: 0 }}>
            {NAV.map((n) => (
              <li key={n.href} className="list-none">
                <a href={n.href} className="block whitespace-nowrap rounded px-2.5 py-1.5 text-[13px] text-ink-muted hover:bg-ground hover:text-ink">{n.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 px-4 py-4 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
