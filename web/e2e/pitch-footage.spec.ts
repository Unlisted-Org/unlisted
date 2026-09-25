import { test, type Page } from "@playwright/test";
import evidence from "../lib/evidence.json";

/*
  Silent footage for the pitch video (docs/video/pitch-script.md), one clip per shot, recorded from
  the live site with motion allowed. Opt-in:
    PITCH_FOOTAGE=1 E2E_BASE_URL=https://unlisted-rosy.vercel.app npx playwright test e2e/pitch-footage.spec.ts
  Clips land in test-results/<test>/video.webm; scripts/collect-footage copies them to docs/video/takes/.
*/
test.skip(!process.env.PITCH_FOOTAGE, "set PITCH_FOOTAGE=1 to record pitch footage");
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", video: { mode: "on", size: { width: 1440, height: 900 } } });
test.describe.configure({ mode: "serial" });

const hold = (p: Page, ms: number) => p.waitForTimeout(ms);
async function glide(p: Page, selector: string, ms = 1800) {
  await p.evaluate(({ sel, ms }) => new Promise<void>((done) => {
    const el = document.querySelector(sel)!; const start = scrollY; const end = el.getBoundingClientRect().top + scrollY - 40;
    const t0 = performance.now(); const step = (t: number) => { const k = Math.min(1, (t - t0) / ms); scrollTo(0, start + (end - start) * (1 - Math.pow(1 - k, 3))); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }), { sel: selector, ms });
}
async function explorer(p: Page, sig: string, network: string) {
  await p.goto(`https://explorer.solana.com/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`, { waitUntil: "load" });
  await p.getByText("Finalized").first().waitFor({ timeout: 45_000 }).catch(() => {});
  await hold(p, 4000);
}

test("01 hero and receipt", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" }); await hold(page, 3500);
  await page.mouse.wheel(0, 250); await hold(page, 3000);
});

test("02 seizure card, then its transaction", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#happened"); await hold(page, 4000);
  await explorer(page, evidence.seizureMainnet[0].signature, "mainnet");
});

test("03 fee chart drawing, then a 300 bps transaction", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#happened", 1200); await hold(page, 4500);
  await explorer(page, evidence.feeChanges.find((f) => f.mint === "OPENAI")!.signature, "mainnet");
});

test("04 the 9:41 multiplier card, then its transaction", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#happened", 1200); await hold(page, 3500);
  await explorer(page, evidence.multiplier.find((m) => m.mint === "OPENAI")!.signature, "mainnet");
});

test("05 Symmetry: pause, then seizure (replayed)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#breaks"); await hold(page, 1500);
  await page.getByRole("button", { name: "Replay" }).click(); await hold(page, 11_000);
  await page.getByRole("button", { name: /Issuer seizes one token from the vault/ }).first().click(); await hold(page, 600);
  await page.getByRole("button", { name: "Replay" }).click(); await hold(page, 9_000);
});

test("06 Unlisted: pause (replayed), then the survival steps", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#breaks"); await hold(page, 800);
  await page.getByRole("button", { name: /Issuer pauses one token mid-redemption/ }).nth(1).click(); await hold(page, 600);
  await page.getByRole("button", { name: "Replay" }).click(); await hold(page, 14_000);
  await glide(page, "#survive", 2500); await hold(page, 3000); await page.mouse.wheel(0, 500); await hold(page, 4000);
});

test("07 cost table, then disclosures", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#cost"); await hold(page, 5000);
  await glide(page, "#disclosures", 1500); await hold(page, 5000);
});

test("08 the signature table, then the close", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" }); await glide(page, "#proof"); await hold(page, 5000);
  await page.mouse.wheel(0, 2200); await hold(page, 3000);
});
