import Link from "next/link";
import { Container } from "../container";
import { Button } from "../ui/button";
import { REPO } from "@/lib/evidence";

export function Close() {
  return (
    <section className="border-t border-line py-16 md:py-24" aria-labelledby="close-title">
      <Container className="flex flex-col items-start gap-6">
        <h2 id="close-title" className="max-w-3xl font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
          For holders of issuer-controlled tokens who need a basket that fails one name at a time
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="shadow-brand">
            <Link href="/app">Open the app (devnet)</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/evidence">Check every signature</Link>
          </Button>
          <Button asChild variant="ghost">
            <a href={REPO}>Source on GitHub</a>
          </Button>
        </div>
      </Container>
    </section>
  );
}
