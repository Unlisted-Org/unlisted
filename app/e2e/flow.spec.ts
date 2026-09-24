// End-to-end, in a real browser (Playwright Chromium), with a Wallet Standard TEST wallet whose
// keypair is generated fresh for this run (not Phantom):
//   1. deposit in kind
//   2. the fixture issuer pauses one leg; the wallet redeems; a claim is created on that leg
//   3. the issuer resumes; the wallet settles the claim
// Every assertion compares something the app rendered from chain data with an INDEPENDENT read:
// the wallet's token balances from the RPC, the mint's paused flag from the node's jsonParsed,
// the ticket account decoded after the fact. None checks text that also appears in static copy.
import { expect, test, Page } from "@playwright/test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_PROGRAM_ID, openClaims, parseEventsFromLogs } from "@stocklana/sdk";
import { RunRecord, depositTickets, feeBpsByRpc, fundWallet, issuerCli, loadEnv, mintPausedByRpc, redemptionTickets, tokenAmount, txOk } from "./harness";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PAUSE_LEG = process.env.E2E_PAUSE_LEG ?? "ANTHROPIC";

async function raw(page: Page, testid: string): Promise<bigint> {
  const v = await page.getByTestId(testid).getAttribute("data-raw");
  if (v == null || v === "") throw new Error(`${testid} has no data-raw`);
  return BigInt(v);
}

/** Waits for the newest tx-log entry to finish; returns its signatures (as rendered by the app). */
async function lastTx(page: Page): Promise<string[]> {
  const entry = page.getByTestId("tx-0");
  await expect(entry).toHaveAttribute("data-status", /ok|failed/, { timeout: 180_000 });
  const status = await entry.getAttribute("data-status");
  const text = await entry.innerText();
  if (status !== "ok") throw new Error(`transaction failed in the app: ${text}`);
  return entry.getByTestId("tx-signature").allInnerTexts();
}

test("deposit, redeem with a paused leg (claim), settle after resume", async ({ page }) => {
  const env = loadEnv();
  const wallet = Keypair.generate(); // fresh for this run
  const owner = wallet.publicKey;
  const rec = new RunRecord(env, owner.toBase58());
  const legIdx = env.legs.findIndex((l) => l.symbol === PAUSE_LEG);
  const pausedMint = new PublicKey(env.legs[legIdx].mint);
  const shot = async (name: string, locator = page.locator("body")) => {
    const file = join(HERE, "runs", `${rec.startedAt.slice(0, 10)}-${env.cluster}-${name}.png`);
    await locator.screenshot({ path: file });
    rec.screenshots.push(file.slice(file.indexOf("e2e/")));
  };
  try {
    await fundWallet(env, owner, 5n * 10n ** 9n, rec);

    await page.addInitScript(`window.__STOCKLANA_TEST_WALLET_SECRET__ = ${JSON.stringify([...wallet.secretKey])};`);
    await page.addInitScript({ path: join(HERE, ".build/test-wallet.js") });
    await page.goto("/");
    await page.getByTestId("connect-Stocklana Test Wallet").click();
    await expect(page.getByTestId("wallet-address")).toHaveText(owner.toBase58());
    await expect(page.getByTestId("pricing-basis")).toBeVisible();
    // With the valuation API connected: the three values the app shows are the API's, not the app's.
    const apiUrl = process.env.E2E_VALUATION_URL;
    if (apiUrl) {
      await expect(page.getByTestId("mock-label")).toHaveCount(0);
      const shown = async () => Promise.all(["value-sell-now", "value-last-trade", "value-reference"].map((t) => page.getByTestId(t).locator(".big").getAttribute("data-usd")));
      await expect.poll(async () => {
        const b = await (await fetch(`${apiUrl}/v1/basket`)).json();
        const v = b.values;
        return JSON.stringify(await shown()) === JSON.stringify([v.sell_now.usd, v.last_trade.usd, v.reference.usd]);
      }, { timeout: 90_000 }).toBe(true);
      rec.add({ step: "price panel shows the valuation API's three values", by: "test wallet (browser)", signatures: [], checks: { values: await shown() } });
    }

    // ---------------------------------------------------------------- 1. deposit in kind
    const shareMint = new PublicKey(env.shareMint);
    const sharesBefore = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    expect(sharesBefore).toBe(0n);
    await page.getByTestId("tab-inkind").click();
    await page.getByTestId("inkind-shares").fill("0.02");
    const expectedShares = await raw(page, "inkind-expected-shares");
    expect(expectedShares).toBeGreaterThan(0n);
    await page.getByTestId("inkind-submit").click();
    const depSigs = await lastTx(page);
    const depTx = await txOk(env, depSigs[0]);
    const sharesAfter = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    // The app's prediction (SDK maths on the chain state it read) equals what the program minted.
    expect(sharesAfter - sharesBefore).toBe(expectedShares);
    const approvals1 = await page.evaluate(() => window.__testWallet!.approvals.map((a) => a.transactions));
    expect(approvals1).toEqual([depSigs.length]);
    rec.add({ step: "deposit in kind (app)", by: "test wallet (browser)", signatures: depSigs, slot: depTx.slot,
      checks: { sharesMinted: String(sharesAfter - sharesBefore), appPredicted: String(expectedShares), walletApprovals: approvals1 } });

    // ---------------------------------------------------------------- 1b. deposit USDC through a ticket
    const usdcMint = new PublicKey(env.usdc);
    const usdcBefore = await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID);
    const sharesBeforeTicket = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    await page.getByTestId("tab-usdc").click();
    await page.getByTestId("usdc-amount").fill("10");
    await expect(page.getByTestId("usdc-quote")).toBeVisible();
    await expect(page.getByTestId("usdc-submit")).toBeEnabled();
    await page.getByTestId("usdc-submit").click();
    const tickSigs = await lastTx(page);
    expect(tickSigs.length).toBeGreaterThanOrEqual(2); // open + swaps + finalize can't fit one transaction
    const approvalsT = await page.evaluate(() => window.__testWallet!.approvals.map((a) => a.transactions));
    expect(approvalsT).toEqual([depSigs.length, tickSigs.length]); // the whole ticket: ONE approval
    const program = new PublicKey(env.programId);
    let tickMinted = 0n;
    let lastSlot = 0;
    for (const sig of tickSigs) {
      const t = await txOk(env, sig);
      lastSlot = t.slot;
      for (const e of parseEventsFromLogs(t.logs, program)) if (e.name === "Minted" && e.path === "Ticket" && e.owner.equals(owner)) tickMinted += e.shares;
    }
    const sharesAfterTicket = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    expect(tickMinted).toBeGreaterThan(0n);
    expect(sharesAfterTicket - sharesBeforeTicket).toBe(tickMinted);
    const usdcAfter = await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID);
    expect(usdcBefore - usdcAfter).toBeGreaterThan(0n);
    expect(usdcBefore - usdcAfter).toBeLessThanOrEqual(10_000_000n);
    expect(await depositTickets(env, owner)).toHaveLength(0); // finalize closed the ticket
    rec.add({ step: "deposit 10 USDC through a deposit ticket (app; fixture_amm router)", by: "test wallet (browser)", signatures: tickSigs, slot: lastSlot,
      checks: { transactions: tickSigs.length, walletApprovals: approvalsT, sharesMinted: String(tickMinted), usdcSpent: String(usdcBefore - usdcAfter) } });
    const sharesAfterAll = sharesAfterTicket;

    // ---------------------------------------------------------------- 2. issuer pauses one leg
    const pauseSig = issuerCli(env, ["pause", pausedMint.toBase58(), "--pause-authority", env.issuerKey]);
    expect(await mintPausedByRpc(env, pausedMint)).toBe(true);
    rec.add({ step: `issuer pauses ${PAUSE_LEG}`, by: "fixture issuer (harness)", signatures: [pauseSig] });
    await page.reload();
    await page.getByTestId("connect-Stocklana Test Wallet").click();
    await expect(page.getByTestId(`banner-paused-${PAUSE_LEG}`)).toBeVisible();
    await expect(page.getByTestId(`leg-availability-${PAUSE_LEG}`)).not.toHaveText("available");
    for (const l of env.legs) if (l.symbol !== PAUSE_LEG) await expect(page.getByTestId(`leg-availability-${l.symbol}`)).toHaveText("available");
    await expect(page.getByTestId("deposit-refused")).toBeVisible();

    // ---------------------------------------------------------------- 3. redeem while paused
    const redeemShares = sharesAfterAll / 2n;
    await page.getByTestId("redeem-shares").fill((Number(redeemShares) / 1e9).toFixed(9));
    await expect(page.getByTestId(`redeem-claim-${PAUSE_LEG}`)).toBeVisible();
    expect(await raw(page, `redeem-claim-${PAUSE_LEG}`)).toBe(redeemShares);
    const predictedNet: Record<string, bigint> = {};
    const before: Record<string, bigint> = {};
    for (const l of env.legs) {
      before[l.symbol] = await tokenAmount(env, owner, new PublicKey(l.mint));
      if (l.symbol !== PAUSE_LEG) predictedNet[l.symbol] = await raw(page, `redeem-net-${l.symbol}`);
    }
    await page.getByTestId("redeem-submit").click();
    const redSigs = await lastTx(page);
    const approvals2 = await page.evaluate(() => window.__testWallet!.approvals.map((a) => a.transactions)); // log restarted at reload
    expect(approvals2).toEqual([redSigs.length]); // one approval covered every transaction of the redemption
    const redTx = await txOk(env, redSigs[redSigs.length - 1]);
    for (const l of env.legs) {
      const after = await tokenAmount(env, owner, new PublicKey(l.mint));
      if (l.symbol === PAUSE_LEG) expect(after - before[l.symbol]).toBe(0n);
      else expect(after - before[l.symbol]).toBe(predictedNet[l.symbol]); // paid now, exactly as the app predicted
    }
    const tickets = await redemptionTickets(env, owner);
    expect(tickets).toHaveLength(1);
    const claims = openClaims(tickets[0].ticket);
    expect(claims).toEqual([{ leg: legIdx, units: redeemShares, reason: "Paused" }]);
    await expect(page.getByTestId(`claim-${PAUSE_LEG}`)).toBeVisible();
    expect(await raw(page, `claim-units-${PAUSE_LEG}`)).toBe(claims[0].units);
    await expect(page.getByTestId(`settle-${PAUSE_LEG}`)).toBeDisabled();
    rec.add({ step: `redeem ${redeemShares} raw shares while ${PAUSE_LEG} is paused (app)`, by: "test wallet (browser)", signatures: redSigs, slot: redTx.slot,
      checks: { walletApprovals: approvals2, paidNow: Object.fromEntries(Object.entries(predictedNet).map(([k, v]) => [k, String(v)])), claim: { leg: PAUSE_LEG, units: String(claims[0].units), reason: claims[0].reason }, ticket: tickets[0].address.toBase58() } });
    await page.getByTestId("claims").scrollIntoViewIfNeeded();
    await shot("1-claim-open", page.getByTestId("claims"));
    await shot("1-redemption-ticket", page.getByTestId("redemptions"));
    await shot("1-claim-open-page");

    // ---------------------------------------------------------------- 4. issuer resumes; settle
    const resumeSig = issuerCli(env, ["resume", pausedMint.toBase58(), "--pause-authority", env.issuerKey]);
    expect(await mintPausedByRpc(env, pausedMint)).toBe(false);
    rec.add({ step: `issuer resumes ${PAUSE_LEG}`, by: "fixture issuer (harness)", signatures: [resumeSig] });
    await page.reload();
    await page.getByTestId("connect-Stocklana Test Wallet").click();
    await expect(page.getByTestId(`leg-availability-${PAUSE_LEG}`)).toHaveText("available");
    await expect(page.getByTestId(`settle-${PAUSE_LEG}`)).toBeEnabled();
    const estimate = await raw(page, `claim-estimate-${PAUSE_LEG}`);
    const estimateGross = BigInt((await page.getByTestId(`claim-estimate-${PAUSE_LEG}`).getAttribute("data-gross"))!);
    const legBefore = await tokenAmount(env, owner, pausedMint);
    await page.getByTestId(`settle-${PAUSE_LEG}`).click();
    const setSigs = await lastTx(page);
    const setTx = await txOk(env, setSigs[0]);
    const legAfter = await tokenAmount(env, owner, pausedMint);
    expect(legAfter - legBefore).toBe(estimate);
    expect(estimate).toBeGreaterThan(0n);
    // The vault paid the app's gross figure; the wallet netted it minus the issuer's transfer fee,
    // with the fee rate read independently from the node's jsonParsed.
    const bps = BigInt(await feeBpsByRpc(env, pausedMint));
    expect(legAfter - legBefore).toBe(estimateGross - (estimateGross * bps + 9_999n) / 10_000n);
    // The ClaimSettled event the app lists carries the program's measured receipt.
    await expect(page.getByTestId(`settled-${PAUSE_LEG}`)).toBeVisible();
    const settledAmount = await raw(page, `settled-amount-${PAUSE_LEG}`);
    expect(settledAmount).toBe(legAfter - legBefore);
    const after = await redemptionTickets(env, owner);
    const open = after.flatMap((t) => openClaims(t.ticket));
    expect(open).toEqual([]);
    await expect(page.getByTestId("no-claims")).toBeVisible();
    rec.add({ step: `settle the ${PAUSE_LEG} claim after resume (app)`, by: "test wallet (browser)", signatures: setSigs, slot: setTx.slot,
      checks: { received: String(legAfter - legBefore), appEstimate: String(estimate), appEstimateGross: String(estimateGross), claimSettledAmount: String(settledAmount), feeBps: Number(bps) } });
    await page.getByTestId("claims").scrollIntoViewIfNeeded();
    await shot("2-claim-settled", page.getByTestId("claims"));
    const redemptions = page.getByTestId("redemptions");
    if (await redemptions.count()) await shot("2-redemption-ticket", redemptions);
    await shot("2-settled-page");
    const approvals = await page.evaluate(() => window.__testWallet!.approvals);
    rec.add({ step: "wallet approvals (test wallet log)", by: "test wallet (browser)", signatures: [], checks: { approvals } });
    console.log(`run file: ${rec.write("passed")}`);
  } catch (e) {
    await shot("failure").catch(() => {});
    console.log(`run file: ${rec.write("failed", String(e))}`);
    throw e;
  }
});
