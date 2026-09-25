import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/*
  Landing page proof bar.
  - Screenshots at 1440 and 390, light and dark, with no wallet present.
  - No page-level horizontal scroll.
  - Every section's key text visible with no wallet.
  - Reduced motion: no running animations after a full scroll, and each animated element in its final state.
  - Complete at rest: with motion allowed, the first frame of every section is already the full content.

  Broken versions (run each and see it fail before relying on the check):
    BROKEN=wide    a 2000px-wide element inside a section         -> "no horizontal scroll" fails
    BROKEN=hide    the survival section hidden                      -> "readable without a wallet" fails
    BROKEN=motion  a component animating despite reduced motion     -> "reduced motion" fails
    BROKEN=blank   one terminal emptied until replayed               -> "complete at rest" fails
    BROKEN=company one of the seven company names removed from the hero -> "what it is" fails
*/
const BROKEN = process.env.BROKEN ?? "";
const SHOTS = "e2e/shots";

async function breakPage(page: Page) {
  if (BROKEN === "wide")
    await page.evaluate(() => { const d = document.createElement("div"); d.style.width = "2000px"; d.style.height = "4px"; document.querySelector("#cost")!.appendChild(d); });
  if (BROKEN === "hide") await page.addStyleTag({ content: "#survive{display:none!important}" });
  if (BROKEN === "motion")
    await page.evaluate(() => { const el = document.querySelector("h1")!; el.animate([{ opacity: 1 }, { opacity: 0.4 }], { duration: 60_000, iterations: Infinity }); });
  if (BROKEN === "company") await page.evaluate(() => { document.querySelector("[data-testid=companies] li:nth-child(3)")?.remove(); });
  if (BROKEN === "blank") await page.evaluate(() => { document.querySelectorAll("#breaks .whitespace-pre-wrap").forEach((n) => n.remove()); });
}

async function open(page: Page, width: number, scheme: "light" | "dark", reducedMotion: "reduce" | "no-preference") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
  await page.goto("/", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await breakPage(page);
}

const SECTIONS: [string, RegExp][] = [
  ["#hero-title", /Seven pre-IPO companies\. One token\. You can always get your share out\./],
  ["#happened-title", /pause, seize and re-price/],
  ["#breaks-title", /Basket protocols break/],
  ["#survive-title", /This one pays you out anyway/],
  ["#cost-title", /About 7\.9% for a \$10,000 round trip/],
  ["#disclosures-title", /What we don.t claim/],
];
const COMPANIES = ["OpenAI", "Anthropic", "Neuralink", "Anduril", "Polymarket", "Kalshi", "FigureAI"];

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`landing ${width} ${scheme}: screenshot, no horizontal scroll, readable without a wallet`, async ({ page }) => {
      await open(page, width, scheme, "reduce");
      // No wallet: nothing injected a Solana provider, and the page must not depend on one.
      expect(await page.evaluate(() => "solana" in window || "phantom" in window)).toBe(false);

      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `page scrolls sideways: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);

      for (const [sel, text] of SECTIONS) {
        const el = page.locator(sel);
        await el.scrollIntoViewIfNeeded();
        await expect(el, `${sel} visible`).toBeVisible();
        await expect(el).toHaveText(text);
      }
      // What it is, on the first screen: all seven companies are named in the hero.
      const names = await page.locator("[data-testid=companies] li").allInnerTexts();
      expect(names, "the seven companies in the hero").toEqual(COMPANIES);
      // The landing keeps one link per claim; the full signature tables live on /evidence.
      expect(await page.locator("a[data-signature]").count(), "evidence links on the landing").toBeGreaterThanOrEqual(8);
      await expect(page.locator("a[href='/evidence']").first()).toBeAttached();

      mkdirSync(SHOTS, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (!BROKEN) await page.screenshot({ path: `${SHOTS}/landing-${width}-${scheme}.png`, fullPage: true });
    });
  }
}

test("reduced motion: nothing animates, and animated parts show their final state", async ({ page }) => {
  await open(page, 1440, "dark", "reduce");
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 600) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(80); }
  await page.waitForTimeout(500);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a.effect as KeyframeEffect)?.target?.nodeName ?? "?"));
  expect(running, `running animations under reduced motion: ${running.join(",")}`).toEqual([]);
  await expect(page.locator("[data-motion]").first()).toHaveAttribute("data-motion", "off");
  // No replay control is offered when motion is reduced.
  await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);
});

test("complete at rest with motion allowed: terminals and fee chart are full before any interaction", async ({ page }) => {
  await open(page, 1440, "light", "no-preference");
  const lines = page.locator("#breaks .whitespace-pre-wrap");
  // The selected run (Symmetry, pause) is complete: 4 commands + 5 output lines.
  expect(await lines.count(), "terminal lines at rest").toBeGreaterThanOrEqual(9);
  await expect(page.locator("#breaks")).toContainText("received: nothing");
  // All four outcomes are visible at rest, not only the selected one.
  for (const [id, text] of [["sym-pause", "Receives nothing"], ["unl-pause", "6 of 7 legs paid immediately"], ["sym-seize", "fails and pays nothing"], ["unl-seize", "shared pro rata"]])
    await expect(page.locator(`[data-outcome="${id}"]`)).toContainText(text);
  await expect(page.locator("#happened svg path").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay" }).first()).toBeVisible();
  writeFileSync(`${SHOTS}/.gitkeep`, "");
});
