import Link from "next/link";
import { cn } from "@/lib/utils";
import { MARK, WORDMARK } from "./brand-paths";

/** The Unlisted U mark (brand/svg/unlisted-mark-*.svg), in the current text colour. */
export const LogoIcon = ({ className }: { className?: string }) => (
  <svg viewBox={`0 0 ${MARK.width} ${MARK.height}`} className={cn("h-6 w-auto", className)} aria-hidden fill="currentColor">
    <path transform={`translate(${-MARK.x} ${-MARK.y})`} d={MARK.d} />
  </svg>
);

/** The UNLISTED wordmark (brand/svg/unlisted-wordmark-*.svg), in the current text colour. */
export const Wordmark = ({ className }: { className?: string }) => (
  <svg viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} className={cn("h-[11px] w-auto", className)} aria-hidden fill="currentColor">
    {WORDMARK.glyphs.map((g, i) => <path key={i} transform={`translate(${g.x} ${g.y})`} d={g.d} />)}
  </svg>
);

/** Mark and wordmark side by side; a link home. */
export const Logo = ({ className, href = "/" }: { className?: string; href?: string }) => (
  <Link href={href} className={cn("flex items-center gap-2.5 text-ink", className)} aria-label="Unlisted home" data-testid="logo">
    <LogoIcon />
    <Wordmark />
  </Link>
);
