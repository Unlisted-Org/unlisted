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
    BROKEN=expanded  the details panels forced open                -> "default view is four things" fails
    BROKEN=allvalues the value expander open by default            -> "one value leads" fails
    BROKEN=costfirst the cost box moved above the buy action       -> "buy box leads with the action" fails
    BROKEN=nopaging  eleven entries shown in an event list         -> "logs are paged" fails
*/
const BROKEN = process.env.BROKEN ?? "";
const SHOTS = "e2e/shots";

async function openApp(page: Page, width: number, scheme: "light" | "dark", reducedMotion: "reduce" | "no-preference" = "no-preference") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
  await page.goto("/app", { waitUntil: "load" });
  // The valuation API computes its first basket slowly (live quotes); wait for real figures.
  // (The hidden-panel broken version fails at the same assertion; it needn't wait out the full budget.)
  await expect(page.getByTestId("value-sell-now").locator("[data-usd]")).toBeVisible({ timeout: BROKEN === "hide" ? 20_000 : 240_000 });
  await expect(page.getByTestId("legs-table")).toBeAttached({ timeout: 60_000 });
  // (A CSS override can't force these open: Tailwind's layered !important [hidden] rule wins. Remove the attribute.)
  if (BROKEN === "expanded") await page.evaluate(() => document.querySelectorAll("[role=tabpanel][hidden]").forEach((p) => p.removeAttribute("hidden")));
  if (BROKEN === "allvalues") await page.evaluate(() => document.querySelector("[data-testid=value-more]")?.setAttribute("open", ""));
  if (BROKEN === "costfirst") await page.evaluate(() => { const c = document.querySelector("[data-testid=cost-box]"); const d = document.querySelector("[data-testid=deposit]"); if (c && d) d.insertBefore(c, d.children[1]); });
  if (BROKEN === "wide") await page.evaluate(() => { const d = document.createElement("div"); d.style.width = "2000px"; d.style.height = "4px"; document.querySelector("#overview")!.appendChild(d); });
  if (BROKEN === "hide") await page.addStyleTag({ content: "#overview{display:none!important}" });
  if (BROKEN === "motion") await page.evaluate(() => { document.querySelector("#overview h2")!.animate([{ opacity: 1 }, { opacity: 0.3 }], { duration: 60_000, iterations: Infinity }); });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`app ${width} ${scheme}: holder's picture, logged out, no horizontal scroll`, async ({ page }) => {
      test.setTimeout(300_000);
      await openApp(page, width, scheme);
      expect(await page.evaluate(() => "solana" in window || "phantom" in window)).toBe(false);
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `page scrolls sideways: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);

      // What it's worth: one value leads; the other two and the gaps are folded behind an expander.
      const sell = page.getByTestId("value-sell-now");
      await sell.scrollIntoViewIfNeeded();
      await expect(sell).toBeVisible();
      await expect(sell).toContainText(/\$\d/);
      // The default view is four things: position, value, buy, sell. Details are collapsed tabs.
      await expect(page.getByTestId("position")).toContainText("Connect a wallet");
      for (const id of ["deposit", "redeem", "tab-inkind", "tab-usdc", "redeem-preview"]) await expect(page.getByTestId(id), `${id}`).toBeVisible();
      await expect(page.locator("[data-testid^='leg-row-']")).toHaveCount(7); // present, folded
      const banners = page.locator("[data-testid^='banner-'], [data-testid='no-issuer-events']");
      expect(await banners.count(), "issuer-event banners or an explicit 'none'").toBeGreaterThan(0);

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

test("app: the default view is four things, and one value leads", async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page, 1440, "light");
  // Every details panel is collapsed by default.
  const open = await page.locator("[role=tabpanel]").evaluateAll((ps) => ps.filter((p) => (p as HTMLElement).offsetParent !== null).map((p) => p.id));
  expect(open, "details panels open by default").toEqual([]);
  await expect(page.getByTestId("value-last-trade"), "last trade folded by default").toBeHidden();
  await expect(page.getByTestId("value-reference"), "reference folded by default").toBeHidden();
  // Opening the expander shows the other two values, each with a dollar figure.
  await page.getByTestId("value-more").locator(":scope > summary").click();
  for (const id of ["value-last-trade", "value-reference"]) await expect(page.getByTestId(id)).toContainText(/\$\d/);
  // A tab opens its panel; the seven-leg table is there.
  await page.getByTestId("details-tab-legs").click();
  await expect(page.getByTestId("legs-table")).toBeVisible();
});

test("app: the buy box leads with the action, the cost follows it", async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page, 1440, "dark");
  const order = await page.evaluate(() => {
    const btn = document.querySelector("[data-testid=inkind-submit]")!, cost = document.querySelector("[data-testid=cost-box]")!;
    return btn.compareDocumentPosition(cost) & Node.DOCUMENT_POSITION_FOLLOWING ? "button, then cost" : "cost, then button";
  });
  expect(order).toBe("button, then cost");
  await expect(page.getByTestId("cost-box")).toContainText("never cheaper");
});

test("app: event logs are paged, ten at a time", async ({ page }) => {
  test.setTimeout(300_000);
  await openApp(page, 1440, "light");
  await page.getByTestId("details-tab-issuer").click();
  const list = page.getByTestId("issuer-list-mainnet");
  await expect(list.locator("li").first()).toBeVisible({ timeout: 120_000 });
  if (BROKEN === "nopaging") await list.evaluate((ul) => { for (let i = 0; i < 11; i++) ul.appendChild(document.createElement("li")); });
  const shown = await list.locator("li").count();
  expect(shown, "entries shown before 'Show more'").toBeLessThanOrEqual(10);
  if (shown === 10) {
    await expect(page.getByTestId("issuer-list-mainnet-more")).toBeVisible();
    await page.getByTestId("issuer-list-mainnet-more").click();
    expect(await list.locator("li").count()).toBeGreaterThan(10);
  }
});
