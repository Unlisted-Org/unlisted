// Abort of an unfinished USDC deposit, in a real browser with the fresh-keypair Wallet Standard TEST
// wallet (not Phantom). Local validator only.
//   1. the harness opens a deposit ticket with the SDK and lands only its first transaction's legs
//      (a deposit that stopped half way), and opens one extra ticket-owned token account, as a
//      router's intermediate would be;
//   2. the app lists the unfinished deposit; the wallet aborts it (unwind each landed leg, then abort);
//   3. checks by independent RPC reads: the ticket is closed, the ticket PDA owns NO token account on
//      either token program (spec 02 Known limitation: abort closes only what it is given), the landed
//      legs' pending amounts are released, and the owner got the escrow back plus the unwound USDC.
import { expect, test, Page } from "@playwright/test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BasketClient, FixtureAmmRouter, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ata, planUsdcDeposit, sendSequential } from "@unlisted/sdk";
import { RunRecord, conn, fundWallet, loadEnv, saveTestWallet, sendAndConfirmTransaction, ticketOwnedByRpc, tokenAmount, txOk } from "./harness";

const HERE = fileURLToPath(new URL(".", import.meta.url));

async function lastTx(page: Page): Promise<string[]> {
  const entry = page.getByTestId("tx-0");
  await expect(entry).toHaveAttribute("data-status", /ok|failed/, { timeout: 180_000 });
  if ((await entry.getAttribute("data-status")) !== "ok") throw new Error(`transaction failed in the app: ${await entry.innerText()}`);
  return entry.getByTestId("tx-signature").allInnerTexts();
}

test("abort an unfinished USDC deposit: unwind, refund, no ticket-owned account left", async ({ page }) => {
  const env = loadEnv();
  if (env.cluster === "devnet") test.skip(true, "local validator only");
  const wallet = Keypair.generate();
  saveTestWallet(wallet);
  const owner = wallet.publicKey;
  const rec = new RunRecord(env, owner.toBase58(), "abort");
  const c = conn(env);
  const client = new BasketClient(c, { programId: new PublicKey(env.programId), shareMint: new PublicKey(env.shareMint) });
  const shot = async (name: string, locator = page.locator("body")) => {
    const file = join(HERE, "runs", `${rec.startedAt.slice(0, 10)}-${env.cluster}-abort-${name}.png`);
    await locator.screenshot({ path: file });
    rec.screenshots.push(file.slice(file.indexOf("e2e/")));
  };
  try {
    await fundWallet(env, owner, 5n * 10n ** 9n, rec);
    const usdcMint = new PublicKey(env.usdc);
    const usdc0 = await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID);

    // 1. a deposit that stopped half way: send only the first transaction of the plan
    let v = await client.fetchBasket();
    const pendingBefore = v.legs.map((l) => l.state.pendingNorm);
    const router = FixtureAmmRouter.live(c, new PublicKey((env as any).fixtureAmm ?? (env as any).programs?.fixtureAmm?.id), v.basket.usdcMint);
    const bh = (await c.getLatestBlockhash("confirmed")).blockhash;
    const usdcIn = 7_000_000n;
    const plan = await planUsdcDeposit({ v, owner, usdcIn, split: v.legs.map(() => 1_000_000n), router, slippageBps: 150, blockhash: bh });
    plan.txs[0].sign([wallet]);
    const sent = await sendSequential(c, [plan.txs[0]]);
    expect(sent[0].err).toBeNull();
    const landedLegs = plan.packing[0].legs;
    expect(landedLegs.length).toBeGreaterThan(0);
    expect(landedLegs.length).toBeLessThan(v.legs.length);
    // A ticket-owned token account besides the escrow, as a route's intermediate would be.
    const interMint = v.legs[v.legs.length - 1].mint;
    const inter = ata(plan.ticket, interMint, TOKEN_2022_PROGRAM_ID);
    const interSig = await sendAndConfirmTransaction(c, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(owner, inter, plan.ticket, interMint, TOKEN_2022_PROGRAM_ID)), [wallet]);
    const ownedBefore = await ticketOwnedByRpc(env, plan.ticket);
    expect(ownedBefore.token2022).toContain(inter.toBase58());
    expect(ownedBefore.token).toContain(plan.escrow.toBase58());
    const escrowBefore = BigInt((await c.getTokenAccountBalance(plan.escrow, "confirmed")).value.amount);
    rec.add({ step: `open a deposit ticket for ${usdcIn} raw USDC and land only legs ${landedLegs.map((i) => v.legs[i].symbol).join(", ")} (SDK, harness)`, by: "test wallet (harness)",
      signatures: [sent[0].signature], checks: { ticket: plan.ticket.toBase58(), escrowBefore: String(escrowBefore) } });
    rec.add({ step: "open one extra ticket-owned Token-2022 account, as a route intermediate would be", by: "test wallet (harness)", signatures: [interSig],
      checks: { account: inter.toBase58(), ticketOwnedBefore: ownedBefore } });

    // 2. the app lists it; the wallet aborts it
    await page.addInitScript(`window.__UNLISTED_TEST_WALLET_SECRET__ = ${JSON.stringify([...wallet.secretKey])};`);
    await page.addInitScript({ path: join(HERE, ".build/test-wallet.js") });
    await page.goto("/");
    await page.getByTestId("connect-Unlisted Test Wallet").click();
    const row = page.getByTestId(`deposit-ticket-${plan.ticket.toBase58()}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId("deposit-ticket-landed")).toHaveText(landedLegs.map((i) => v.legs[i].symbol).join(", "));
    await shot("1-unfinished", page.getByTestId("open-deposit-tickets"));
    const usdcPre = await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID);
    await page.getByTestId(`abort-${plan.ticket.toBase58()}`).click();
    const sigs = await lastTx(page);
    const approvals = await page.evaluate(() => window.__testWallet!.approvals.map((a) => a.transactions));
    expect(approvals).toEqual([sigs.length]); // unwinds + abort under one approval
    expect(sigs.length).toBe(landedLegs.length + 1);
    for (const s of sigs) await txOk(env, s);

    // 3. independent checks
    expect(await c.getAccountInfo(plan.ticket, "confirmed")).toBeNull();
    const left = await ticketOwnedByRpc(env, plan.ticket);
    expect(left).toEqual({ token: [], token2022: [] });
    v = await client.fetchBasket();
    for (const [i, l] of v.legs.entries()) expect(l.state.pendingNorm).toBe(pendingBefore[i]);
    const refunded = (await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID)) - usdcPre;
    expect(refunded).toBeGreaterThan(escrowBefore); // the escrow plus what the unwound legs sold for
    expect(usdc0 - (usdcPre + refunded)).toBeLessThan(usdcIn); // lost only swap fees and the leg transfer fee
    rec.add({ step: `abort the unfinished deposit in the app: unwind ${landedLegs.length} leg(s), then abort_deposit`, by: "test wallet (browser)", signatures: sigs,
      checks: { walletApprovals: approvals, ticketClosed: true, ticketOwnedAfterAbort: left, refundedUsdc: String(refunded), escrowBefore: String(escrowBefore),
        usdcCostOfRoundTrip: String(usdc0 - (usdcPre + refunded)), pendingNormRestored: true } });
    await shot("2-page");
    console.log(`run file: ${rec.write("passed")}`);
  } catch (e) {
    await shot("failure").catch(() => {});
    console.log(`run file: ${rec.write("failed", String(e))}`);
    throw e;
  }
});
