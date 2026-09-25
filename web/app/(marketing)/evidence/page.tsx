import type { Metadata } from "next";
import { Container } from "@/components/container";
import { Proof } from "@/components/landing/proof";
import { Sig, NetBadge } from "@/components/landing/sig";
import { evidence, recordUrl, REPO, type Tx } from "@/lib/evidence";
import { int, slot } from "@/lib/format";

export const metadata: Metadata = {
  title: "Unlisted evidence",
  description: "Every transaction behind the Unlisted landing page: the issuer's own mainnet transactions, and every Unlisted scenario on devnet, with slots and records.",
};

function H2({ id, children, sub }: { id: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-20 flex-col gap-2">
      <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] md:text-3xl">{children}</h2>
      {sub && <p className="max-w-3xl text-[14px] text-ink-muted">{sub}</p>}
    </div>
  );
}

function Table({ head, rows, label }: { head: string[]; rows: React.ReactNode[][]; label: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[720px] text-left text-[13px]" aria-label={label}>
        <thead className="bg-ground font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className="px-3 py-2.5">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const txRows = (txs: Tx[]) =>
  txs.map((t) => [t.label, <Sig key="s" signature={t.signature} network={t.network} />, <span key="l" className="font-mono tabular text-ink-muted">{slot(t.slot)}</span>,
    <a key="r" className="text-[12px] underline" href={recordUrl(t.record)}>record</a>]);

export default function EvidencePage() {
  const b = evidence.browser;
  return (
    <main className="py-12 md:py-16">
      <Container className="flex flex-col gap-12">
        <header className="flex flex-col gap-4">
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-paid">Evidence</p>
          <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-[-0.015em] md:text-5xl">Every transaction behind the landing page</h1>
          <p className="max-w-3xl text-base text-ink-muted">
            Each signature below links to the Solana Explorer on its network, and each one is checked on chain before the
            site is built: finalized, no error, and at its recorded slot. Mainnet rows are the issuer&apos;s own transactions.
            Devnet rows are Unlisted&apos;s program running against fixture tokens that mirror the real mints extension for extension.
          </p>
          <nav aria-label="Evidence sections" className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            {[["#mainnet", "The issuer, on mainnet"], ["#devnet", "Unlisted, on devnet"], ["#proof", "Every other issuer action"], ["#symmetry", "Symmetry and the mainnet fork"], ["#sources", "Sources"]].map(([h, t]) => (
              <a key={h} href={h} className="text-paid underline underline-offset-2">{t}</a>
            ))}
          </nav>
        </header>

        <section className="flex flex-col gap-6" aria-labelledby="mainnet-h">
          <H2 id="mainnet" sub="Read from mainnet; signed by the PreStocks issuer's multisig vault WV9PJN7X…, never by us.">
            <span id="mainnet-h">The issuer, on mainnet</span>
          </H2>
          <h3 className="font-display text-lg font-semibold">Seizure: 29 holder accounts emptied on 19 Sep 2025 (two of the seven transactions)</h3>
          <Table label="Seizure transactions" head={["Transaction", "Network"]} rows={evidence.seizureMainnet.map((s) => [<Sig key="s" signature={s.signature} network={s.network} />, <NetBadge key="n" network={s.network} />])} />
          <h3 className="font-display text-lg font-semibold">Transfer fee set to 300 bps on all seven mints (24 Sep 2026, in force from epoch 1043)</h3>
          <Table label="Fee change transactions" head={["Mint", "Transaction"]} rows={evidence.feeChanges.map((f) => [<span key="m" className="font-mono">{f.mint}</span>, <Sig key="s" signature={f.signature} network={f.network} />])} />
          <h3 className="font-display text-lg font-semibold">Display multiplier changes, and the warning each gave</h3>
          <Table label="Multiplier changes" head={["Mint", "New multiplier", "Signed (UTC)", "In force (UTC)", "Warning", "Transaction"]}
            rows={evidence.multiplier.map((m) => [<span key="m" className="font-mono">{m.mint}</span>, m.multiplier, m.signed, m.effective, <b key="w">{m.warning}</b>, <Sig key="s" signature={m.signature} network={m.network} />])} />
        </section>

        <section className="flex flex-col gap-6" aria-labelledby="devnet-h">
          <H2 id="devnet" sub="Unlisted's program on devnet. Every row is finalized; the record links to the JSON with every step and check.">
            <span id="devnet-h">Unlisted, on devnet</span>
          </H2>
          <h3 className="font-display text-lg font-semibold">A pause during a redemption (the landing page&apos;s four steps)</h3>
          <Table label="Pause walkthrough" head={["Step", "Transaction", "Slot", "Record"]} rows={txRows(evidence.survive)} />
          <h3 className="font-display text-lg font-semibold">A seizure from the vault</h3>
          <Table label="Seizure scenario" head={["Step", "Transaction", "Slot", "Record"]} rows={txRows(evidence.seizure)} />
          <h3 className="font-display text-lg font-semibold">The same flow in a browser, by a wallet created for the run</h3>
          <p className="text-[14px] text-ink-muted">Wallet <span className="font-mono">{b.wallet}</span>. With ANTHROPIC paused the redemption paid six legs now:{" "}
            {Object.entries(b.paidNow).map(([k, v]) => `${k} ${int(v)}`).join(", ")}; ANTHROPIC became a claim of {int(b.claim.units)} units, settled after the resume for {int(b.settled.received)}, exactly the app&apos;s estimate.</p>
          <Table label="Browser run" head={["Step", "Transaction", "Slot", "Record"]} rows={txRows(b.steps)} />
        </section>

        <Proof />

        <section className="flex flex-col gap-4" aria-labelledby="symmetry-h">
          <H2 id="symmetry"><span id="symmetry-h">Symmetry, and the mainnet fork</span></H2>
          <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-[14px] text-ink-muted">
            <li>Symmetry&apos;s own deployed program ({evidence.symmetry.program.slice(0, 8)}…) on a copy of mainnet. With one constituent paused mid-redemption, the shares were burned and the wallet received {evidence.symmetry.pauseReceived} constituent tokens until the resume. <a className="text-paid underline" href={recordUrl("evidence/symmetry-fork/out/pause.json")}>Transcript</a>.</li>
            <li>With one constituent seized from the vault, the redemption failed and the wallet received {evidence.symmetry.seizeReceived}; every later redeemer is stuck. <a className="text-paid underline" href={recordUrl("evidence/symmetry-fork/out/seize.json")}>Transcript</a>.</li>
            <li>Live mainnet read at slot {evidence.symmetry.reconSlot.toLocaleString("en-US")}: {evidence.symmetry.vaultsScanned} Symmetry vaults scanned; recorded holdings disagree with actual balances. <a className="text-paid underline" href={recordUrl("evidence/symmetry-fork/out/mainnet-recon.json")}>Read</a>.</li>
            <li>Unlisted&apos;s own routing path against the seven real PreStocks mints and live Jupiter routes, on a mainnet fork taken at slot {evidence.fork.forkStartSlot.toLocaleString("en-US")}. <a className="text-paid underline" href={recordUrl(evidence.fork.record)}>Transcript</a>.</li>
            <li>Reproduce Symmetry&apos;s runs: <code className="font-mono text-ink">cd evidence/symmetry-fork; ./run.sh</code>.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="sources-h">
          <H2 id="sources"><span id="sources-h">Sources</span></H2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[14px]">
            <li><a className="text-paid underline" href={recordUrl("docs/risks.md")}>docs/risks.md</a>: the issuer record, costs and the SPV dispute, with primary quotes.</li>
            <li><a className="text-paid underline" href={recordUrl("evidence/build-proven.py")}>evidence/build-proven.py</a>: builds the full proven list, re-checking every signature on chain.</li>
            <li><a className="text-paid underline" href={recordUrl("web/e2e/BROKEN-VERSIONS.md")}>web/e2e/BROKEN-VERSIONS.md</a>: every check on this site, and the broken version each was seen failing against.</li>
            <li><a className="text-paid underline" href={REPO}>The repository</a>.</li>
          </ul>
        </section>
      </Container>
    </main>
  );
}
