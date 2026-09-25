// Cleanup: settle every open claim held by this suite's saved test wallets (e2e/holder/.local/wallets),
// so a failed or broken-version run never leaves a claim open on the canonical devnet basket.
// Settlement is permissionless: the app key pays as cranker; each payout goes to the claim's owner.
//   E2E_ENV=devnet SETTLE_OPEN_CLAIMS=1 npx playwright test e2e/holder/devnet/settle-open-claims.spec.ts
import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { BasketClient, confirmByPolling, openClaims, planSettleClaim } from "@unlisted/sdk";
import { conn, loadEnv, loadKey, redemptionTickets, txOk } from "../harness";

test.skip(process.env.E2E_ENV !== "devnet" || !process.env.SETTLE_OPEN_CLAIMS, "set E2E_ENV=devnet SETTLE_OPEN_CLAIMS=1");

test("settle open claims held by saved test wallets", async () => {
  test.setTimeout(10 * 60_000);
  const env = loadEnv();
  const c = conn(env);
  const cranker = loadKey(env.funderKey!);
  const client = new BasketClient(c, { programId: new PublicKey(env.programId), shareMint: new PublicKey(env.shareMint) });
  const dir = join(__dirname, "../.local/wallets");
  const owners = [dir, join(dir, "swept")].flatMap((d) => { try { return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => new PublicKey(f.replace(".json", ""))); } catch { return []; } });
  const settled: string[] = [];
  for (const owner of owners) {
    for (const { address, ticket } of await redemptionTickets(env, owner)) {
      for (const cl of openClaims(ticket)) {
        const v = await client.fetchBasket();
        if (v.legs[cl.leg].unavailable.length) { console.log(`skip ${owner.toBase58()} ${v.legs[cl.leg].symbol}: leg unavailable`); continue; }
        const { blockhash } = await c.getLatestBlockhash("finalized");
        const tx = planSettleClaim({ v, cranker: cranker.publicKey, ticket: address, owner, leg: cl.leg, blockhash });
        tx.sign([cranker]);
        const raw = tx.serialize();
        const sig = await c.sendRawTransaction(raw);
        const st = await confirmByPolling(c, sig, raw);
        if (st.err) throw new Error(`settle ${sig} failed: ${JSON.stringify(st.err)}`);
        await txOk(env, sig);
        settled.push(`${owner.toBase58()} ${v.legs[cl.leg].symbol} ${cl.units} units: ${sig}`);
      }
    }
  }
  console.log(`checked ${owners.length} wallets; settled ${settled.length}\n${settled.join("\n")}`);
  for (const owner of owners) for (const t of await redemptionTickets(env, owner)) expect(openClaims(t.ticket), owner.toBase58()).toEqual([]);
});
