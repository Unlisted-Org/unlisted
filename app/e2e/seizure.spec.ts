// Seizure, in a real browser with the fresh-keypair Wallet Standard TEST wallet (not Phantom):
//   1. deposit in kind
//   2. the fixture issuer, as permanent delegate, burns part of one basket vault (a seizure)
//   3. the app shows the unrecorded drop; the wallet records it with the permissionless observe
//   4. a redemption pays that leg pro rata less: the same fraction every holder loses
// Checks compare the app's figures with independent RPC reads and the program's own event.
import { expect, test, Page } from "@playwright/test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BasketClient, TOKEN_PROGRAM_ID, math, parseEventsFromLogs, transferFee } from "@unlisted/sdk";
import { RunRecord, conn as rpcConn, fundWallet, issuerSeize, loadEnv, tokenAmount, txOk } from "./harness";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SEIZE_LEG = process.env.E2E_SEIZE_LEG ?? "NEURALINK";
const SEIZE_BPS = 2000n; // 20% of the vault

async function raw(page: Page, testid: string): Promise<bigint> {
  const v = await page.getByTestId(testid).getAttribute("data-raw");
  if (v == null || v === "") throw new Error(`${testid} has no data-raw`);
  return BigInt(v);
}
async function lastTx(page: Page): Promise<string[]> {
  const entry = page.getByTestId("tx-0");
  await expect(entry).toHaveAttribute("data-status", /ok|failed/, { timeout: 180_000 });
  if ((await entry.getAttribute("data-status")) !== "ok") throw new Error(`transaction failed in the app: ${await entry.innerText()}`);
  return entry.getByTestId("tx-signature").allInnerTexts();
}

test("seizure: drop recorded on chain and shared pro rata", async ({ page }) => {
  const env = loadEnv();
  const wallet = Keypair.generate();
  const owner = wallet.publicKey;
  const rec = new RunRecord(env, owner.toBase58(), "seizure");
  const conn = rpcConn(env);
  const shareMint = new PublicKey(env.shareMint);
  const bc = new BasketClient(conn, { programId: new PublicKey(env.programId), shareMint });
  const shot = async (name: string, locator = page.locator("body")) => {
    const file = join(HERE, "runs", `${rec.startedAt.slice(0, 10)}-${env.cluster}-seizure-${name}.png`);
    await locator.screenshot({ path: file });
    rec.screenshots.push(file.slice(file.indexOf("e2e/")));
  };
  try {
    await fundWallet(env, owner, 5n * 10n ** 9n, rec);
    await page.addInitScript(`window.__UNLISTED_TEST_WALLET_SECRET__ = ${JSON.stringify([...wallet.secretKey])};`);
    await page.addInitScript({ path: join(HERE, ".build/test-wallet.js") });
    await page.goto("/");
    await page.getByTestId("connect-Unlisted Test Wallet").click();
    await expect(page.getByTestId("wallet-address")).toHaveText(owner.toBase58());

    // 1. deposit in kind, 40% of what the wallet's legs can mint
    let v = await bc.fetchBasket();
    let maxShares: bigint | null = null;
    for (const l of v.legs) {
      const bal = await tokenAmount(env, owner, l.mint);
      const m = ((bal - transferFee(bal, l.feeNow)) * (v.shareSupply + l.state.claimUnits)) / math.owned(l.state);
      maxShares = maxShares === null || m < maxShares ? m : maxShares;
    }
    await page.getByTestId("tab-inkind").click();
    await page.getByTestId("inkind-shares").fill((Number((maxShares! * 4n) / 10n) / 1e9).toFixed(9));
    await page.getByTestId("inkind-submit").click();
    const depSigs = await lastTx(page);
    await txOk(env, depSigs[0]);
    const shares = await tokenAmount(env, owner, shareMint, TOKEN_PROGRAM_ID);
    expect(shares).toBeGreaterThan(0n);
    rec.add({ step: "deposit in kind (app)", by: "test wallet (browser)", signatures: depSigs, checks: { shares: String(shares) } });

    // What redeeming half would pay on the seized leg BEFORE the seizure (SDK maths on chain state).
    const redeemShares = shares / 2n;
    v = await bc.fetchBasket();
    const legIdx = v.legs.findIndex((l) => l.symbol === SEIZE_LEG);
    const leg = v.legs[legIdx];
    const before = math.redeemInKind(v.legs.map((l) => l.state), v.shareSupply, redeemShares, v.legs.map((l) => l.feeNow))[legIdx];
    if (before.action !== "pay") throw new Error("seized leg must be available");

    // 2. the issuer seizes 20% of the vault
    const vaultBefore = (await conn.getTokenAccountBalance(leg.vault, "confirmed")).value.amount;
    const seizeAmount = (BigInt(vaultBefore) * SEIZE_BPS) / 10_000n;
    const seizeSigs = await issuerSeize(env, SEIZE_LEG, leg.vault, seizeAmount);
    const vaultAfter = BigInt((await conn.getTokenAccountBalance(leg.vault, "confirmed")).value.amount);
    expect(BigInt(vaultBefore) - vaultAfter).toBe(seizeAmount);
    rec.add({ step: `issuer seizes ${seizeAmount} raw (20%) from the ${SEIZE_LEG} vault as permanent delegate`, by: "fixture issuer (harness)", signatures: seizeSigs });

    // 3. the app shows the unrecorded drop; the wallet records it on chain
    await page.reload();
    await page.getByTestId("connect-Unlisted Test Wallet").click();
    await expect(page.getByTestId(`unobserved-shortfall-${SEIZE_LEG}`)).toBeVisible();
    expect(await raw(page, `unobserved-shortfall-${SEIZE_LEG}`)).toBe(seizeAmount);
    await shot("1-unrecorded", page.getByTestId("legs-table"));
    await page.getByTestId(`observe-${SEIZE_LEG}`).click();
    const obsSigs = await lastTx(page);
    const obsTx = await txOk(env, obsSigs[0]);
    const evs = parseEventsFromLogs(obsTx.logs, new PublicKey(env.programId)).filter((e) => e.name === "ShortfallObserved");
    expect(evs).toHaveLength(1);
    const ev = evs[0] as Extract<(typeof evs)[number], { name: "ShortfallObserved" }>;
    expect(ev.leg).toBe(legIdx);
    expect(ev.expected - ev.actual).toBe(seizeAmount);
    await expect(page.getByTestId(`banner-shortfall-${SEIZE_LEG}`)).toBeVisible();
    await expect(page.getByTestId(`unobserved-shortfall-${SEIZE_LEG}`)).toHaveCount(0);
    rec.add({ step: `record the drop with the permissionless observe (app)`, by: "test wallet (browser)", signatures: obsSigs, slot: obsTx.slot,
      checks: { expected: String(ev.expected), actual: String(ev.actual), lossIndex: String(ev.lossIndex) } });
    await shot("2-recorded-banner", page.getByTestId(`banner-shortfall-${SEIZE_LEG}`));

    // 4. redeem half: the seized leg pays pro rata less; the other legs are untouched by it
    await page.getByTestId("redeem-shares").fill((Number(redeemShares) / 1e9).toFixed(9));
    const predicted = await raw(page, `redeem-net-${SEIZE_LEG}`);
    const balBefore = await tokenAmount(env, owner, leg.mint);
    await page.getByTestId("redeem-submit").click();
    const redSigs = await lastTx(page);
    const redTx = await txOk(env, redSigs[redSigs.length - 1]);
    const received = (await tokenAmount(env, owner, leg.mint)) - balBefore;
    expect(received).toBe(predicted);
    // Pro rata: the gross falls by exactly the vault's fraction lost, within 1 unit (spec 01 model test).
    const expectedGross = (before.gross * ev.actual) / ev.expected;
    const net = (g: bigint) => g - transferFee(g, leg.feeNow);
    expect(received >= net(expectedGross - 1n) && received <= net(expectedGross + 1n)).toBe(true);
    expect(received).toBeLessThan(before.net);
    rec.add({ step: `redeem ${redeemShares} raw shares after the seizure (app)`, by: "test wallet (browser)", signatures: redSigs, slot: redTx.slot,
      checks: { seizedLeg: SEIZE_LEG, grossBeforeSeizure: String(before.gross), expectedGrossAfter: String(expectedGross), received: String(received), appPredicted: String(predicted) } });
    await shot("3-page");
    console.log(`run file: ${rec.write("passed")}`);
  } catch (e) {
    await shot("failure").catch(() => {});
    console.log(`run file: ${rec.write("failed", String(e))}`);
    throw e;
  }
});
