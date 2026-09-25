"use client";
// Section frame from the Aceternity Pro block `feature-section-with-terminal` (steps beside a terminal),
// adapted: the terminal plays once, when it scrolls into view, and the four steps advance with it in
// order; it stops on the last one and never loops. There is no replay control. Under reduced motion
// (and in the server render) every line is printed at once. Every step's outcome is always visible.
import { useRef, useState } from "react";
import { useInView } from "motion/react";
import { Terminal } from "../ui/terminal";
import { Container } from "../container";
import { useMotionAllowed } from "../motion";
import { evidence, recordUrl } from "@/lib/evidence";
import { int, shortSig, slot } from "@/lib/format";
import { cn } from "@/lib/utils";

type Run = { commands: string[]; outputs: Record<number, string[]> };
type Item = { id: string; who: "Symmetry" | "Unlisted"; action: string; outcome: string; good: boolean; where: string; record: string; run: Run };

function items(): Item[] {
  const b = evidence.browser;
  const pause = b.steps.find((s) => s.label.includes("pauses"))!;
  const redeem = b.steps.find((s) => s.label.startsWith("Redeem"))!;
  const settle = b.steps.find((s) => s.label.startsWith("Settle"))!;
  const paid = Object.entries(b.paidNow);
  const [seize, observe, redeemSeized] = evidence.seizure;
  return [
    {
      id: "sym-pause", who: "Symmetry", action: "Issuer pauses one token mid-redemption", good: false,
      outcome: "Shares burned. Receives nothing until the issuer unpauses.",
      where: "Its own program on a mainnet fork", record: "evidence/symmetry-fork/out/pause.json",
      run: {
        commands: ["symmetry sell 50,000 shares", "issuer pause NVDAx", "symmetry redeem", "symmetry redeem   # retry"],
        outputs: {
          0: ["✓ shares burned; withdrawal pending"],
          1: ["NVDAx paused (one of six constituents)"],
          2: ["✗ reverted: Token-2022 0x43, mint is paused", "✗ received: nothing, not even the five unpaused constituents"],
          3: ["✗ reverted again; shares already gone"],
        },
      },
    },
    {
      id: "unl-pause", who: "Unlisted", action: "Issuer pauses one token mid-redemption", good: true,
      outcome: `${paid.length} of 7 legs paid immediately; the paused one settles after the resume.`,
      where: "Devnet, a fresh wallet, in the browser", record: "app/e2e/runs/2026-09-24-devnet.json",
      run: {
        commands: ["issuer pause ANTHROPIC", `unlisted redeem ${int(b.claim.units)} shares`, "issuer resume ANTHROPIC", "unlisted settle-claim ANTHROPIC"],
        outputs: {
          0: [`ANTHROPIC paused · ${shortSig(pause.signature)}`],
          1: [
            `✓ paid now: ${paid.length} of 7 legs · slot ${slot(redeem.slot)}`,
            ...paid.map(([leg, v]) => `  ${leg.padEnd(11)} ${int(v)}`),
            `  ANTHROPIC   claim of ${int(b.claim.units)} units`,
            `  ${shortSig(redeem.signature)}`,
          ],
          2: ["ANTHROPIC resumed"],
          3: [`✓ received ${int(b.settled.received)} ANTHROPIC · slot ${slot(settle.slot)}`, `  ${shortSig(settle.signature)}`],
        },
      },
    },
    {
      id: "sym-seize", who: "Symmetry", action: "Issuer seizes one token from the vault", good: false,
      outcome: "Every redemption after the seizure fails and pays nothing.",
      where: "Its own program on a mainnet fork", record: "evidence/symmetry-fork/out/seize.json",
      run: {
        commands: ["issuer seize AAPLx from the vault", "symmetry sell 50,000 shares", "symmetry redeem"],
        outputs: {
          0: ["vault holds 0 AAPLx; Symmetry still records 27,183"],
          1: ["✓ accepted against the AAPLx that no longer exists"],
          2: ["✗ reverted: insufficient funds", "✗ received: nothing. Every redeemer after the seizure is stuck"],
        },
      },
    },
    {
      id: "unl-seize", who: "Unlisted", action: "Issuer seizes one token from the vault", good: true,
      outcome: "The loss is recorded and shared pro rata; redemptions keep paying.",
      where: "Devnet, the program's seizure scenario", record: seize.record,
      run: {
        commands: ["issuer seize NEURALINK from the vault", "unlisted observe", "unlisted redeem"],
        outputs: {
          0: [`vault NEURALINK balance drops · slot ${slot(seize.slot)}`, `  ${shortSig(seize.signature)}`],
          1: [`✓ shortfall recorded; shared pro rata by every holder · slot ${slot(observe.slot)}`, `  ${shortSig(observe.signature)}`],
          2: ["✓ paid: six legs in full, NEURALINK pro rata less", `  slot ${slot(redeemSeized.slot)} · ${shortSig(redeemSeized.signature)}`],
        },
      },
    },
  ];
}

export function Versus() {
  const all = items();
  const allowed = useMotionAllowed();
  const stage = useRef<HTMLDivElement>(null);
  const inView = useInView(stage, { once: true, amount: 0.5 });
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true); // the scroll-triggered run; a click on a step ends it
  const autoRef = useRef(true);
  const [finished, setFinished] = useState(false);
  const playing = allowed && auto && !finished;
  const current = all[active];
  const next = () => {
    if (!auto) return;
    if (active < all.length - 1) setTimeout(() => { if (autoRef.current) setActive((a) => a + 1); }, 1200);
    else setFinished(true);
  };
  const stateOf = (i: number) => (!playing ? (i === active ? "active" : "done") : i < active ? "done" : i === active ? "active" : "next");
  return (
    <section id="breaks" className="border-y border-line bg-ground py-16 md:py-24" aria-labelledby="breaks-title">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <h2 id="breaks-title" className="max-w-3xl font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
            Basket protocols break when the issuer acts
          </h2>
          <p className="max-w-2xl text-base text-ink-muted md:text-lg">
            We ran Symmetry, a live Solana basket protocol, with its own deployed program on a copy of mainnet. One paused
            constituent loses the whole redemption after the shares are already burned. A seizure fails every redemption
            that follows. Symmetry handles transfer fees correctly; the issuer's other powers are the problem.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10 [&>*]:min-w-0" data-motion={allowed ? "on" : "off"} data-run={finished ? "finished" : playing ? "playing" : "static"}>
          <div ref={stage} className="order-2 flex flex-col gap-3 lg:order-1">
            <p className="text-[13px] text-ink-muted">
              <span className="font-medium text-ink">{current.who}</span> · {current.where} ·{" "}
              <a className="underline" href={recordUrl(current.record)}>record</a>
            </p>
            <Terminal key={`${current.id}-${allowed && auto ? "run" : "static"}`} animate={allowed && auto} start={inView} onDone={next}
              typingSpeed={20} delayBetweenCommands={420} initialDelay={active === 0 ? 250 : 150}
              username={current.who === "Symmetry" ? "symmetry-mainnet-fork" : "unlisted-devnet"}
              commands={current.run.commands} outputs={current.run.outputs} className="max-w-none px-0" />
          </div>
          <ol className="order-1 flex flex-col lg:order-2" aria-label="Issuer actions, Symmetry vs Unlisted">
            {all.map((it, i) => {
              const st = stateOf(i);
              return (
                <li key={it.id} data-step={it.id} data-state={st} aria-current={st === "active" ? "step" : undefined}
                  className={cn("border-l-2 transition-[opacity,border-color] duration-500",
                    st === "active" ? (it.good ? "border-paid" : "border-issuer") : "border-line",
                    st === "next" ? "opacity-35" : "opacity-100")}>
                  <button type="button" onClick={() => { autoRef.current = false; setAuto(false); setActive(i); }}
                    className="flex w-full flex-col gap-1 py-3 pl-5 pr-2 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                        it.good ? "bg-paid-soft text-paid" : "bg-issuer-soft text-issuer")}>{it.who}</span>
                      <span className="font-display text-[17px] font-semibold">{it.action}</span>
                    </span>
                    <span className={cn("text-[14px]", it.good ? "text-paid" : "text-issuer")} data-outcome={it.id}>{it.outcome}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="text-[13px] text-ink-muted">
          The full Symmetry transcripts, the fork slot, and a live read of Symmetry's mainnet vaults:{" "}
          <a className="text-paid underline underline-offset-2" href="/evidence#symmetry">the evidence page</a>.
        </p>
      </Container>
    </section>
  );
}
