import { Container } from "../container";
import { evidence, recordUrl, REPO } from "@/lib/evidence";
import { slot } from "@/lib/format";
import { Sig } from "./sig";

const SCENARIO: Record<string, string> = {
  "frozen-vault": "Frozen vault",
  "hook-switched-on": "Transfer hook switched on",
  "multiplier-change-mid-position": "Display multiplier changed",
  "fee-change-mid-position": "Transfer fee raised",
};

export function Proof() {
  const rows = [
    ...evidence.proofTable.map((r) => ({ group: SCENARIO[r.scenario] ?? r.scenario, ...r })),
    ...evidence.deposit.map((r) => ({ group: "Deposit and refund", ...r })),
    { group: "Program deployed", label: `Program ${evidence.deploy.program.slice(0, 8)}…; deployed bytes match the tested build`, signature: evidence.deploy.signature, slot: evidence.deploy.slot, network: evidence.deploy.network, record: "tests/program/devnet/deploy.json" },
  ];
  return (
    <section id="proof" className="border-t border-line py-16 md:py-24" aria-labelledby="proof-title">
      <Container className="flex flex-col gap-8">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div className="flex flex-col gap-4">
            <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-paid">Here are the signatures</p>
            <h2 id="proof-title" className="max-w-2xl font-display text-3xl font-semibold tracking-[-0.01em] md:text-5xl">
              Every other issuer action, tested the same way
            </h2>
          </div>
          <p className="max-w-xl text-base text-ink-muted md:text-lg">
            Each row is a finalized devnet transaction against fixture tokens that mirror the real mints extension for
            extension. Only the issuer's keys can do these things, so on mainnet they can't be tested at all.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="bg-ground font-mono text-[10px] uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-normal">Issuer action</th>
                <th className="px-4 py-3 font-normal">What happened</th>
                <th className="px-4 py-3 font-normal">Transaction</th>
                <th className="px-4 py-3 text-right font-normal">Slot</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.signature} className="border-t border-line align-top">
                  <td className="px-4 py-3 font-medium">{i === 0 || rows[i - 1].group !== r.group ? r.group : ""}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.label}{" "}
                    <a className="whitespace-nowrap text-[12px] underline underline-offset-2" href={recordUrl(r.record)}>record</a>
                  </td>
                  <td className="max-w-[360px] px-4 py-3"><Sig signature={r.signature} network={r.network} /></td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] tabular text-ink-muted">{slot(r.slot)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-ink-muted">
          The routing path was also run against the seven real PreStocks mints and live Jupiter routes on a copy of mainnet
          taken at slot {evidence.fork.forkStartSlot.toLocaleString("en-US")} (<a className="underline" href={recordUrl(evidence.fork.record)}>transcript</a>).
          The full list of what's proven, every signature re-checked on chain, is built by{" "}
          <a className="underline" href={`${REPO}/blob/main/evidence/build-proven.py`}>evidence/build-proven.py</a>.
        </p>
      </Container>
    </section>
  );
}
