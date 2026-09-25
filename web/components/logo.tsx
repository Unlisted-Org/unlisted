import Link from "next/link";
import { cn } from "@/lib/utils";

/** Seven legs; one hollow. The basket keeps working with a leg out. */
export const LogoIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 30 10" className={cn("h-2.5 w-[30px]", className)} aria-hidden>
    {Array.from({ length: 7 }).map((_, i) =>
      i === 1 ? (
        <rect key={i} x={i * 4.2 + 0.6} y="0.6" width="2.8" height="8.8" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
      ) : (
        <rect key={i} x={i * 4.2} y="0" width="4" height="10" rx="0.8" fill="currentColor" />
      ),
    )}
  </svg>
);

export const Logo = ({ className }: { className?: string }) => (
  <Link href="/" className={cn("flex items-center gap-2 text-ink", className)} aria-label="Unlisted home">
    <LogoIcon />
    <span className="font-display text-[17px] font-semibold tracking-[-0.01em]">Unlisted</span>
  </Link>
);
