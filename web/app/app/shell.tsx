"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";

export const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/buy", label: "Buy" },
  { href: "/app/sell", label: "Sell" },
  { href: "/app/claims", label: "Claims" },
  { href: "/app/basket", label: "Basket" },
  { href: "/app/history", label: "History" },
];

/** The app frame: a header, a sidebar flush with the left edge, and one route per sidebar item. No motion. */
export function AppShell({ children, wallet, badges = {}, notice }: { children: ReactNode; wallet?: ReactNode; badges?: Record<string, ReactNode>; notice?: ReactNode }) {
  const path = usePathname();
  return (
    <div className="holder min-h-screen bg-ground">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:px-5">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="rounded-sm border border-claim/40 bg-claim-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-claim">devnet</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/" className="hidden text-[13px] text-ink-muted hover:text-ink md:inline">About Unlisted</Link>
          <a href="https://unlisted-docs.vercel.app/app/dashboard/" className="hidden text-[13px] text-ink-muted hover:text-ink md:inline">Docs</a>
          <ModeToggle />
          {wallet}
        </div>
      </header>
      <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 content-start lg:content-stretch lg:grid-cols-[208px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-surface lg:border-b-0 lg:border-r">
        <nav aria-label="App" data-testid="app-nav" className="lg:sticky lg:top-14">
          <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0.5 lg:px-3 lg:py-4" style={{ margin: 0 }}>
            {NAV.map((n) => {
              const on = n.href === "/app" ? path === "/app" : path?.startsWith(n.href);
              return (
                <li key={n.href} className="list-none">
                  <Link href={n.href} aria-current={on ? "page" : undefined} data-testid={`nav-${n.label.toLowerCase()}`}
                    className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13px] ${on ? "bg-ground font-medium text-ink" : "text-ink-muted hover:bg-ground hover:text-ink"}`}>
                    {n.label}
                    {badges[n.href]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        </aside>
        <main className="min-w-0 px-4 py-6 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-[1080px]">
            {notice}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
