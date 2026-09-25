import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/*
  Holder app proof bar (no wallet: the page must be complete and readable logged out).
  - Screenshots at 1440 and 390, light and dark.
  - No page-level horizontal scroll.
  - The holder's picture is on the page: three labelled values with dollar figures, all seven legs,
    the issuer-event banners, deposit (both kinds), redeem with its per-leg preview, claims.
  - No motion at all, even when the viewer allows motion.
  - The landing page's "Open app" link reaches the app (the old 404).

  Broken versions (each must fail before the real run is relied on):
    BROKEN=wide    a 2000px element inside the legs panel          -> no horizontal scroll fails
    BROKEN=hide    the value panel hidden                          -> the holder's picture fails
    BROKEN=motion  an animation inside the app                     -> no motion fails
    BROKEN=404     the landing link points at a missing route      -> the app link check fails
*/
const BROKEN = process.env.BROKEN ?? "";
const SHOTS = "e2e/shots";

async function openApp(page: Page, width: number, scheme: "light" | "dark", reducedMotion: "reduce" | "no-preference" = "no-preference") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
  await page.goto("/app", { waitUntil: "load" });
  // The valuation API computes its first basket slowly (live quotes); wait for real figures.
  await expect(page.getByTestId("value-sell-now").locator("[data-usd]")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("legs-table")).toBeVisible({ timeout: 60_000 });
  if (BROKEN === "wide") await page.evaluate(() => { const d = document.createElement("div"); d.style.width = "2000px"; d.style.height = "4px"; document.querySelector("#legs")!.appendChild(d); });
  if (BROKEN === "hide") await page.addStyleTag({ content: "#overview{display:none!important}" });
  if (BROKEN === "motion") await page.evaluate(() => { document.querySelector("#legs h2")!.animate([{ opacity: 1 }, { opacity: 0.3 }], { duration: 60_000, iterations: Infinity }); });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`app ${width} ${scheme}: holder's picture, logged out, no horizontal scroll`, async ({ page }) => {
      test.setTimeout(300_000);
      await openApp(page, width, scheme);
      expect(await page.evaluate(() => "solana" in window || "phantom" in window)).toBe(false);
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `page scrolls sideways: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);

      for (const id of ["value-sell-now", "value-last-trade", "value-reference"]) {
        const card = page.getByTestId(id);
        await card.scrollIntoViewIfNeeded();
        await expect(card, `${id} visible`).toBeVisible();
        await expect(card).toContainText(/\$\d/);
      }
      await expect(page.locator("[data-testid^='leg-row-']")).toHaveCount(7);
      const banners = page.locator("[data-testid^='banner-'], [data-testid='no-issuer-events']");
      expect(await banners.count(), "issuer-event banners or an explicit 'none'").toBeGreaterThan(0);
      for (const id of ["deposit", "redeem", "tab-inkind", "tab-usdc", "redeem-preview"]) await expect(page.getByTestId(id), `${id}`).toBeVisible();
      await expect(page.locator("#claims")).toContainText("Connect a wallet");

      mkdirSync(SHOTS, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (!BROKEN) await page.screenshot({ path: `${SHOTS}/app-${width}-${scheme}.png`, fullPage: true });
    });
  }
}

test("app: no motion, even when the viewer allows it", async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page, 1440, "dark", "no-preference");
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 700) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(60); }
  await page.getByTestId("tab-usdc").click();
  await page.getByTestId("tab-inkind").click();
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  expect(running, "animations running in the app").toBe(0);
  const transition = await page.evaluate(() => getComputedStyle(document.querySelector("#deposit button")!).transitionDuration);
  expect(transition, "transition on app controls").toMatch(/^0s(, 0s)*$/);
});

test("the landing page's Open app link reaches the app", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/", { waitUntil: "load" });
  if (BROKEN === "404") await page.evaluate(() => document.querySelectorAll("a[href='/app']").forEach((a) => a.setAttribute("href", "/apps")));
  const link = page.getByRole("link", { name: "Open app" }).first();
  const href = await link.getAttribute("href");
  // A direct load of the link's target: the server answers 200 and it is the app.
  const res = await page.request.get(href!);
  expect(res.status(), `GET ${href}`).toBe(200);
  // And following the link in the page lands on the app.
  await link.click();
  await expect(page.getByRole("heading", { name: "Your Unlisted position" })).toBeVisible({ timeout: 60_000 });
});
