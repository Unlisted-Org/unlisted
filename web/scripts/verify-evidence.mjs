// Fails the build unless every signature in lib/evidence.json is finalized without error on its
// network, and, where the record gives a slot, landed at exactly that slot.
// Usage: node scripts/verify-evidence.mjs [path/to/evidence.json]
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? new URL("../lib/evidence.json", import.meta.url).pathname;
const RPC = { devnet: "https://api.devnet.solana.com", mainnet: "https://api.mainnet-beta.solana.com" };
const B58 = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

const found = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (typeof o.signature === "string") found.push({ sig: o.signature, slot: o.slot ?? null, network: o.network });
    Object.values(o).forEach(walk);
  }
})(JSON.parse(readFileSync(file, "utf8")));

const problems = [];
for (const f of found) {
  if (!B58.test(f.sig)) problems.push(`malformed signature ${f.sig}`);
  if (!RPC[f.network]) problems.push(`unknown network "${f.network}" for ${f.sig}`);
}

async function statuses(url, sigs) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [sigs, { searchTransactionHistory: true }] }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.result) return r.result.value;
    if (r?.error && r.error.code !== 429) throw new Error(`${url}: ${JSON.stringify(r.error)}`);
    await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1)));
  }
  throw new Error(`${url}: no answer`);
}

for (const [network, url] of Object.entries(RPC)) {
  const mine = found.filter((f) => f.network === network && B58.test(f.sig));
  for (let i = 0; i < mine.length; i += 200) {
    const chunk = mine.slice(i, i + 200);
    const vals = await statuses(url, chunk.map((f) => f.sig));
    chunk.forEach((f, j) => {
      const v = vals[j];
      if (!v) return problems.push(`${network} ${f.sig}: not found`);
      if (v.err !== null) problems.push(`${network} ${f.sig}: failed on chain ${JSON.stringify(v.err)}`);
      if (v.confirmationStatus !== "finalized") problems.push(`${network} ${f.sig}: ${v.confirmationStatus}, not finalized`);
      if (f.slot !== null && v.slot !== f.slot) problems.push(`${network} ${f.sig}: record says slot ${f.slot}, chain says ${v.slot}`);
    });
  }
}

if (problems.length) {
  console.error(`evidence check FAILED (${problems.length}):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log(`evidence check passed: ${found.length} signatures finalized without error; ${found.filter((f) => f.slot !== null).length} at their recorded slot`);
