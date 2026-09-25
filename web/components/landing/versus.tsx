"use client";
import { useState } from "react";
import { Terminal } from "../ui/terminal";
import { Container } from "../container";
import { useMotionAllowed } from "../motion";
import { evidence, recordUrl } from "@/lib/evidence";
import { int, shortSig, slot } from "@/lib/format";

// Symmetry's own deployed program on a mainnet fork (evidence/symmetry-fork/README.md §2 and §3).
const SYMMETRY_PAUSE = {
  commands: ["symmetry sell 50,000 shares", "issuer pause NVDAx", "symmetry redeem", "symmetry redeem   # retry"],
  outputs: {
    0: ["✓ shares burned; withdrawal pending"],
    1: ["NVDAx paused (one of six constituents)"],
    2: ["✗ reverted: Token-2022 0x43, mint is paused", "✗ received: nothing, not even the five unpaused constituents"],
    3: ["✗ reverted again; shares already gone"],
  } as Record<number, string[]>,
};
const SYMMETRY_SEIZE = {
  commands: ["issuer seize AAPLx from the vault", "symmetry sell 50,000 shares", "symmetry redeem"],
  outputs: {
    0: ["vault holds 0 AAPLx; Symmetry still records 27,183"],
    1: ["✓ accepted against the AAPLx that no longer exists"],
    2: ["✗ reverted: insufficient funds", "✗ received: nothing. Every redeemer after the seizure is stuck"],
  } as Record<number, string[]>,
};

function unlistedRun() {
  const b = evidence.browser;
  const pause = b.steps.find((s) => s.label.includes("pauses"))!;
  const redeem = b.steps.find((s) => s.label.startsWith("Redeem"))!;
  const settle = b.steps.find((s) => s.label.startsWith("Settle"))!;
  const paid = Object.entries(b.paidNow);
  return {
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
    } as Record<number, string[]>,
  };
}

function Panel({ title, note, run, tab }: { title: string; note: React.ReactNode; run: { commands: string[]; outputs: Record<number, string[]> }; tab: string }) {
  const allowed = useMotionAllowed();
  const [plays, setPlays] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-semibold">{title}</h3>
          <p className="text-[13px] text-ink-muted">{note}</p>
        </div>
        {allowed && (
          <button
            type="button"
            onClick={() => setPlays((p) => p + 1)}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 font-mono text-[11px] text-ink-muted hover:text-ink"
          >
            Replay
          </button>
        )}
      </div>
      <Terminal key={plays} animate={plays > 0} typingSpeed={28} delayBetweenCommands={500} initialDelay={200}
        username={tab} commands={run.commands} outputs={run.outputs} className="max-w-none px-0" />
    </div>
  );
}

export function Versus() {
  const [mode, setMode] = useState<"pause" | "seize">("pause");
  const sym = mode === "pause" ? SYMMETRY_PAUSE : SYMMETRY_SEIZE;
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
        <div role="tablist" aria-label="Issuer action" className="flex gap-2">
          {(["pause", "seize"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => setMode(m)}
              className={`rounded-md border px-3 py-1.5 text-[13px] ${mode === m ? "border-ink bg-ink text-ground" : "border-line text-ink-muted hover:text-ink"}`}>
              {m === "pause" ? "Issuer pauses one token" : "Issuer seizes from the vault"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <Panel
            key={`sym-${mode}`}
            tab="symmetry-mainnet-fork"
            title="Symmetry"
            run={sym}
            note={<>Its own program on a mainnet fork. <a className="underline" href={recordUrl(`evidence/symmetry-fork/out/${mode === "pause" ? "pause" : "seize"}.json`)}>Transcript</a></>}
          />
          {mode === "pause" ? (
            <Panel
              tab="unlisted-devnet"
              title="Unlisted"
              run={unlistedRun()}
              note={<>Devnet, a fresh wallet, in the browser. <a className="underline" href={recordUrl("app/e2e/runs/2026-09-24-devnet.json")}>Record</a></>}
            />
          ) : (
            <SeizeUnlisted />
          )}
        </div>
      </Container>
    </section>
  );
}

function SeizeUnlisted() {
  const [seize, observe, redeem] = evidence.seizure;
  return (
    <Panel
      tab="unlisted-devnet"
      title="Unlisted"
      note={<>Devnet, the program's seizure scenario. <a className="underline" href={recordUrl(seize.record)}>Record</a></>}
      run={{
        commands: ["issuer seize NEURALINK from the vault", "unlisted observe", "unlisted redeem"],
        outputs: {
          0: [`vault NEURALINK balance drops · slot ${slot(seize.slot)}`, `  ${shortSig(seize.signature)}`],
          1: [`✓ shortfall recorded; shared pro rata by every holder · slot ${slot(observe.slot)}`, `  ${shortSig(observe.signature)}`],
          2: ["✓ paid: six legs in full, NEURALINK pro rata less", `  slot ${slot(redeem.slot)} · ${shortSig(redeem.signature)}`],
        },
      }}
    />
  );
}
