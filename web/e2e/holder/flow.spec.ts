// End-to-end, in a real browser (Playwright Chromium), with a Wallet Standard TEST wallet whose
// keypair is generated fresh for this run (not Phantom). The whole story runs on the Overview (/app),
// through the app's own controls, the way it is shown live:
//   0. get test tokens (the app's faucet)
//   1. buy in (deposit in kind)
//   2. the issuer pauses one company (the app's passcode-gated fixture-issuer control)
//   3. redeem anyway: six pay now, the paused one becomes a claim
//   4. the pause lifts; the claim pays out (Settle on the company's tile)
// Then the other routes, with the wallet still connected: Claims lists the settled claim, Buy takes a
// USDC deposit ticket, Basket shows the valuation API's three values and each mint's multiplier.
// Every assertion compares something the app rendered from chain data with an INDEPENDENT read:
// the wallet's token balances from the RPC, the mint's paused flag from the node's jsonParsed,
// the ticket account decoded after the fact. None checks text that also appears in static copy.
import { expect as baseExpect, test, Page } from "@playwright/test";
// The app re-reads devnet through a rate-limited RPC: up to 60 s per assertion.
const expect = baseExpect.configure({ timeout: 60_000 });
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { BasketClient, TOKEN_PROGRAM_ID, openClaims, parseEventsFromLogs } from "@unlisted/sdk";
import fixtures from "../../lib/fixtures.json";
import { RunRecord, conn, saveTestWallet, settleOpenClaims, depositTickets, feeBpsByRpc, fundSol, issuerAction, loadEnv, returnSol, mintPausedByRpc, multipliersByRpc, redemptionTickets, ticketOpenedBy, ticketOwnedByRpc, tokenAmount, tokenAmounts, txOk } from "./harness";

const HERE = __dirname + "/";
const PAUSE_LEG = process.env.E2E_PAUSE_LEG ?? "ANTHROPIC";
// The presenter's demo passcode: E2E_DEMO_PASSCODE, or the gitignored local copy.
const PASSCODE = process.env.E2E_DEMO_PASSCODE ?? (() => { try { return readFileSync(join(HERE, ".local/demo-passcode"), "utf8").trim(); } catch { return ""; } })();

// E2E_VIDEO=1 records the run (demo footage): 1440x900, the whole browser session, saved as test-results/**/video.webm.
if (process.env.E2E_VIDEO) test.use({ viewport: { width: 1440, height: 900 }, video: { mode: "on", size: { width: 1440, height: 900 } }, colorScheme: "dark" });

// Opt-in: this spends devnet SOL and has the fixture issuer pause a leg of the canonical basket.
test.skip(process.env.E2E_ENV !== "devnet", "set E2E_ENV=devnet to run the fresh-wallet devnet flow");

async function raw(page: Page, testid: string): Promise<bigint> {
  const v = await page.getByTestId(testid).getAttribute("data-raw");
  if (v == null || v === "") throw new Error(`${testid} has no data-raw`);
  return BigInt(v);
}

/** Set by the test: records every app transaction the moment it lands. */
let onChain: ((s: { step: string; signatures: string[]; ms: number }) => void) | null = null;

/** Waits for the newest tx-log entry to finish; returns its signatures (as rendered by the app). */
async function lastTx(page: Page, label: RegExp): Promise<string[]> {
  const t0 = Date.now(); // called right after the click: this is what a viewer waits
  const entry = page.getByTestId("tx-0");
  await expect(entry).toContainText(label);
  await expect(entry).toHaveAttribute("data-status", /ok|failed/, { timeout: 180_000 });
  const status = await entry.getAttribute("data-status");
  const text = await entry.innerText();
  const sigs = await entry.getByTestId("tx-signature").allInnerTexts();
  // On the record at once, before any check on this step can fail: a run's record lists everything it put on chain.
  onChain?.({ step: `landed: ${label.source}${status === "ok" ? "" : " (failed in the app)"}`, signatures: sigs, ms: Date.now() - t0 });
  if (status !== "ok") throw new Error(`transaction failed in the app: ${text}`);
  return sigs;
}

const approvals = (page: Page) => page.evaluate(() => window.__testWallet!.approvals.map((a) => a.transactions));

test("buy in, issuer pauses one, redeem anyway (claim), pause lifts, claim pays out: all on the Overview", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  expect(PASSCODE, "demo passcode (E2E_DEMO_PASSCODE or e2e/holder/.local/demo-passcode)").not.toBe("");
  const env = loadEnv();
  const wallet = Keypair.generate(); // fresh for this run
  saveTestWallet(wallet); // gitignored; lets e2e/devnet/sweep.ts recover leftover SOL if a run dies
  const owner = wallet.publicKey;
  const rec = new RunRecord(env, owner.toBase58(), "overview");
  const legIdx = env.legs.findIndex((l) => l.symbol === PAUSE_LEG);
  const pausedMint = new PublicKey(env.legs[legIdx].mint);
  const legMints = env.legs.map((l) => new PublicKey(l.mint));
  const shareMint = new PublicKey(env.shareMint);
  const usdcMint = new PublicKey(env.usdc);
  const shot = async (name: string, locator = page.locator("body")) => {
    const file = join(HERE, "runs", `${rec.startedAt.slice(0, 10)}-${env.cluster}-${name}.png`);
    await locator.screenshot({ path: file });
    rec.screenshots.push(file.slice(file.indexOf("e2e/")));
  };
  const onOverview = () => expect(page).toHaveURL(/\/app$/);
  onChain = ({ step, signatures, ms }) => { if (signatures.length) rec.add({ step, by: /pauses|resumes/.test(step) ? "fixture issuer (app control)" : "test wallet (browser)", signatures, checks: { clickToOkMs: ms } }); };
  let pausedByUs = false;
  try {
    expect(await mintPausedByRpc(env, pausedMint)).toBe(false); // a shared fixture: never start from someone else's pause
    await fundSol(env, owner, 0.08 * LAMPORTS_PER_SOL, rec);

    await page.addInitScript(`window.__UNLISTED_TEST_WALLET_SECRET__ = ${JSON.stringify([...wallet.secretKey])};`);
    await page.addInitScript({ path: join(HERE, ".build/test-wallet.js") });
    const apiBaskets: any[] = [];
    page.on("response", async (r) => {
      if (/\/v1\/basket(\?|$)/.test(r.url()) && r.ok()) { try { apiBaskets.push(await r.json()); } catch {} }
    });
    await page.goto("/app");
    // One Connect button; the wallet adapter's modal lists the wallets this browser has.
    await page.getByTestId("connect-wallet").click();
    await page.getByRole("button", { name: /Unlisted Test Wallet/ }).click();
    await expect(page.getByTestId("wallet-address")).toHaveAttribute("data-address", owner.toBase58());
    await expect(page.getByTestId(`tile-state-${PAUSE_LEG}`)).toHaveText("available");

    // ---------------------------------------------------------------- 0. test tokens (the app's faucet)
    await page.getByTestId("faucet-submit").click();
    const faucetSigs = await lastTx(page, /Get test tokens/);
    expect(await approvals(page)).toEqual([faucetSigs.length]); // both faucet transactions: one approval
    const got = await tokenAmounts(env, owner, legMints);
    for (const [i, l] of env.legs.entries()) expect(got[i]).toBe(BigInt(fixtures.legs.find((f) => f.symbol === l.symbol)!.faucetRaw));
    expect(await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID)).toBe(BigInt(fixtures.usdc.faucetRaw));
    rec.add({ step: "get test tokens (app faucet: server signs as the fixture mint authority, the wallet pays)", by: "test wallet (browser)", signatures: faucetSigs,
      checks: { legs: Object.fromEntries(env.legs.map((l, i) => [l.symbol, String(got[i])])), usdc: fixtures.usdc.faucetRaw } });
    await onOverview();

    // ---------------------------------------------------------------- 1. buy in
    const sharesBefore = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    expect(sharesBefore).toBe(0n);
    await expect(page.getByTestId("demo-buy-expected")).toBeVisible();
    const expectedShares = await raw(page, "demo-buy-expected");
    expect(expectedShares).toBeGreaterThan(0n);
    await page.getByTestId("demo-buy-submit").click();
    const depSigs = await lastTx(page, /Buy in/);
    const depTx = await txOk(env, depSigs[0]);
    const sharesAfter = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    // The app's prediction (SDK maths on the chain state it read) equals what the program minted.
    expect(sharesAfter - sharesBefore).toBe(expectedShares);
    expect(await approvals(page)).toEqual([faucetSigs.length, depSigs.length]);
    await expect(page.getByTestId("position-shares-summary")).toHaveAttribute("data-raw", sharesAfter.toString());
    rec.add({ step: "buy in: deposit in kind (Overview)", by: "test wallet (browser)", signatures: depSigs, slot: depTx.slot,
      checks: { sharesMinted: String(sharesAfter - sharesBefore), appPredicted: String(expectedShares) } });
    await onOverview();

    // ---------------------------------------------------------------- 2. the issuer pauses one company
    await page.getByTestId("issuer-symbol").selectOption(PAUSE_LEG);
    await page.getByTestId("issuer-passcode").fill(PASSCODE);
    await page.getByTestId("issuer-pause").click();
    pausedByUs = true;
    const pauseSigs = await lastTx(page, new RegExp(`pauses ${PAUSE_LEG}`));
    expect(await mintPausedByRpc(env, pausedMint)).toBe(true);
    rec.add({ step: `issuer pauses ${PAUSE_LEG} (the app's fixture-issuer control, passcode-gated)`, by: "fixture issuer (app control)", signatures: pauseSigs });
    await expect(page.getByTestId(`tile-${PAUSE_LEG}`)).toHaveAttribute("data-state", "unavailable");
    for (const l of env.legs) if (l.symbol !== PAUSE_LEG) await expect(page.getByTestId(`tile-state-${l.symbol}`)).toHaveText("available");
    await expect(page.getByTestId(`banner-paused-${PAUSE_LEG}`)).toBeVisible();
    await expect(page.getByTestId("demo-buy-refused")).toBeVisible();
    await onOverview();

    // ---------------------------------------------------------------- 3. redeem anyway
    // As filmed: the Redeem box's default, every share the wallet holds. Nothing is typed.
    const redeemShares = sharesAfter;
    await expect(page.getByTestId("demo-redeem-shares")).toHaveValue((Number(redeemShares) / 1e9).toFixed(9).replace(/\.?0+$/, ""));
    await expect(page.getByTestId(`tile-claimnext-${PAUSE_LEG}`)).toHaveAttribute("data-raw", redeemShares.toString());
    const predictedNet: Record<string, bigint> = {};
    for (const l of env.legs) if (l.symbol !== PAUSE_LEG) predictedNet[l.symbol] = await raw(page, `tile-receive-${l.symbol}`);
    const beforeBals = await tokenAmounts(env, owner, legMints);
    await shot("overview-1-paused-before-redeem");
    await page.getByTestId("demo-redeem-submit").click();
    const redSigs = await lastTx(page, /Redeem in kind/);
    expect((await approvals(page)).slice(-1)).toEqual([redSigs.length]); // one approval covered the whole redemption
    const redTx = await txOk(env, redSigs[redSigs.length - 1]);
    const afterBals = await tokenAmounts(env, owner, legMints);
    for (const [i, l] of env.legs.entries()) {
      if (l.symbol === PAUSE_LEG) expect(afterBals[i] - beforeBals[i]).toBe(0n);
      else expect(afterBals[i] - beforeBals[i]).toBe(predictedNet[l.symbol]); // paid now, exactly as the tile said
    }
    const tickets = await redemptionTickets(env, owner);
    expect(tickets).toHaveLength(1);
    const claims = openClaims(tickets[0].ticket);
    expect(claims).toEqual([{ leg: legIdx, units: redeemShares, reason: "Paused" }]);
    await expect(page.getByTestId(`tile-claim-${PAUSE_LEG}`)).toHaveAttribute("data-raw", claims[0].units.toString());
    await expect(page.getByTestId(`tile-settle-${PAUSE_LEG}`)).toBeDisabled();
    await expect(page.getByTestId("position-open-claims")).toBeVisible();
    rec.add({ step: `redeem ${redeemShares} raw shares while ${PAUSE_LEG} is paused (Overview)`, by: "test wallet (browser)", signatures: redSigs, slot: redTx.slot,
      checks: { paidNow: Object.fromEntries(Object.entries(predictedNet).map(([k, v]) => [k, String(v)])), claim: { leg: PAUSE_LEG, units: String(claims[0].units), reason: claims[0].reason }, ticket: tickets[0].address.toBase58() } });
    await shot("overview-2-claim-open");
    await onOverview();

    // ---------------------------------------------------------------- 4. the pause lifts; the claim pays out
    await page.getByTestId("issuer-resume").click();
    const resumeSigs = await lastTx(page, new RegExp(`resumes ${PAUSE_LEG}`));
    expect(await mintPausedByRpc(env, pausedMint)).toBe(false);
    pausedByUs = false;
    rec.add({ step: `issuer resumes ${PAUSE_LEG} (the app's fixture-issuer control)`, by: "fixture issuer (app control)", signatures: resumeSigs });
    await expect(page.getByTestId(`tile-settle-${PAUSE_LEG}`)).toBeEnabled();
    const estimate = await raw(page, `tile-estimate-${PAUSE_LEG}`);
    const estimateGross = BigInt((await page.getByTestId(`tile-estimate-${PAUSE_LEG}`).getAttribute("data-gross"))!);
    const legBefore = await tokenAmount(env, owner, pausedMint);
    await page.getByTestId(`tile-settle-${PAUSE_LEG}`).click();
    const setSigs = await lastTx(page, new RegExp(`Settle ${PAUSE_LEG}`));
    const setTx = await txOk(env, setSigs[0]);
    const legAfter = await tokenAmount(env, owner, pausedMint);
    expect(estimate).toBeGreaterThan(0n);
    expect(legAfter - legBefore).toBe(estimate);
    // The vault paid the app's gross figure; the wallet netted it minus the issuer's transfer fee,
    // with the fee rate read independently from the node's jsonParsed.
    const bps = BigInt(await feeBpsByRpc(env, pausedMint));
    expect(legAfter - legBefore).toBe(estimateGross - (estimateGross * bps + 9_999n) / 10_000n);
    expect((await redemptionTickets(env, owner)).flatMap((t) => openClaims(t.ticket))).toEqual([]);
    await expect(page.getByTestId(`tile-claim-${PAUSE_LEG}`)).toHaveCount(0);
    rec.add({ step: `settle the ${PAUSE_LEG} claim after resume (Overview tile)`, by: "test wallet (browser)", signatures: setSigs, slot: setTx.slot,
      checks: { received: String(legAfter - legBefore), appEstimate: String(estimate), appEstimateGross: String(estimateGross), feeBps: Number(bps) } });
    await shot("overview-3-claim-paid");
    await onOverview();

    // ---------------------------------------------------------------- the other routes, same session
    await page.getByTestId("nav-claims").click();
    await expect(page).toHaveURL(/\/app\/claims$/);
    await expect(page.getByTestId("wallet-address")).toHaveAttribute("data-address", owner.toBase58()); // no reconnect
    await expect(page.getByTestId("no-claims")).toBeVisible();
    await expect(page.getByTestId(`settled-${PAUSE_LEG}`)).toBeVisible();
    expect(await raw(page, `settled-received-${PAUSE_LEG}`)).toBe(legAfter - legBefore);
    expect(await raw(page, `settled-gross-${PAUSE_LEG}`)).toBe(estimateGross);
    await shot("claims-settled", page.getByTestId("claims"));

    // A USDC deposit ticket on the Buy route: open + swaps + finalize, one approval.
    await page.getByTestId("nav-buy").click();
    await expect(page).toHaveURL(/\/app\/buy$/);
    const usdcBefore = await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID);
    const sharesBeforeTicket = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    await page.getByTestId("tab-usdc").click();
    await page.getByTestId("usdc-amount").fill(process.env.E2E_USDC ?? "10");
    await expect(page.getByTestId("usdc-quote")).toBeVisible({ timeout: 180_000 }); // the service quotes Jupiter live
    await expect(page.getByTestId("usdc-submit")).toBeEnabled();
    await page.getByTestId("usdc-submit").click();
    const tickSigs = await lastTx(page, /Buy with USDC/);
    expect(tickSigs.length).toBeGreaterThanOrEqual(2);
    expect((await approvals(page)).slice(-1)).toEqual([tickSigs.length]);
    const program = new PublicKey(env.programId);
    const depTicket = await ticketOpenedBy(env, tickSigs[0]);
    const leftAfterFinalize = await ticketOwnedByRpc(env, depTicket);
    expect(leftAfterFinalize).toEqual({ token: [], token2022: [] });
    expect(await conn(env).getAccountInfo(depTicket, "confirmed")).toBeNull();
    let tickMinted = 0n;
    let lastSlot = 0;
    for (const sig of tickSigs) {
      const t = await txOk(env, sig);
      lastSlot = t.slot;
      for (const e of parseEventsFromLogs(t.logs, program)) if (e.name === "Minted" && e.path === "Ticket" && e.owner.equals(owner)) tickMinted += e.shares;
    }
    expect(tickMinted).toBeGreaterThan(0n);
    expect((await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID)) - sharesBeforeTicket).toBe(tickMinted);
    const usdcSpent = usdcBefore - (await tokenAmount(env, owner, usdcMint, TOKEN_PROGRAM_ID));
    expect(usdcSpent).toBeGreaterThan(0n);
    expect(usdcSpent).toBeLessThanOrEqual(10_000_000n);
    expect(await depositTickets(env, owner)).toHaveLength(0);
    rec.add({ step: "deposit 10 USDC through a deposit ticket (Buy route; fixture_amm router)", by: "test wallet (browser)", signatures: tickSigs, slot: lastSlot,
      checks: { ticket: depTicket.toBase58(), ticketOwnedAfterFinalize: leftAfterFinalize, transactions: tickSigs.length, sharesMinted: String(tickMinted), usdcSpent: String(usdcSpent) } });

    // The Basket route: the three values are the valuation API's, and each mint's effective multiplier.
    await page.getByTestId("nav-basket").click();
    await expect(page).toHaveURL(/\/app\/basket$/);
    if (process.env.E2E_VALUATION_URL) {
      await expect(page.getByTestId("mock-label")).toHaveCount(0);
      const shown = async () => Promise.all(["value-sell-now", "value-last-trade", "value-reference"].map((t) => page.getByTestId(t).locator(".big").getAttribute("data-usd")));
      const triple = (b: any) => JSON.stringify([b.values?.sell_now?.usd, b.values?.last_trade?.usd, b.values?.reference?.usd]);
      let match: any = null;
      await expect.poll(async () => {
        const now = JSON.stringify(await shown());
        match = apiBaskets.filter((b) => b?.values?.sell_now).reverse().find((b) => triple(b) === now) ?? null;
        return match ? "match" : `panel ${now}; ${apiBaskets.length} API responses received`;
      }, { timeout: 180_000 }).toBe("match");
      rec.add({ step: "Basket route shows the valuation API's three values", by: "test wallet (browser)", signatures: [],
        checks: { values: await shown(), apiGeneratedAt: match.as_of?.generated_at, pricingBasis: match.pricing_basis?.kind } });
    }
    const mults = await multipliersByRpc(env, legMints);
    for (const [i, l] of env.legs.entries()) {
      const m = mults[i];
      if (m && Math.abs(Date.now() / 1000 - m.at) < 120) continue; // a change taking effect right now: skip rather than race it
      await expect(page.getByTestId(`leg-multiplier-${l.symbol}`)).toHaveAttribute("data-value", String(m ? m.effective : 1));
    }
    rec.add({ step: "Basket route shows each mint's effective display multiplier (RPC jsonParsed)", by: "test wallet (browser)", signatures: [],
      checks: { multipliers: Object.fromEntries(env.legs.map((l, i) => [l.symbol, mults[i]])) } });

    rec.add({ step: "wallet approvals (test wallet log)", by: "test wallet (browser)", signatures: [], checks: { approvals: await page.evaluate(() => window.__testWallet!.approvals) } });
    console.log(`run file: ${rec.write("passed")}`);
  } catch (e) {
    await shot("failure").catch(() => {});
    // Never leave a shared fixture mint paused: resume it if this run paused it and failed before resuming.
    if (pausedByUs && (await mintPausedByRpc(env, pausedMint).catch(() => false))) {
      const sigs = issuerAction(env, "resume", PAUSE_LEG);
      rec.add({ step: `cleanup: issuer resumes ${PAUSE_LEG} after the failure`, by: "fixture issuer (harness)", signatures: sigs });
    }
    // Nor a claim open: settle whatever this run's wallet is still owed (after the resume above).
    const settled = await settleOpenClaims(env, owner).catch((err) => { console.log(`claims not settled: ${err}`); return []; });
    if (settled.length) rec.add({ step: "cleanup: settle this run's open claims after the failure", by: "funder (harness)", signatures: settled });
    console.log(`run file: ${rec.write("failed", String(e))}`);
    throw e;
  } finally {
    await returnSol(env, wallet, rec).catch((err) => console.log(`SOL not returned: ${err}`));
  }
});
