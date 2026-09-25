import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import evidence from "../lib/evidence.json";

/*
  /evidence proof bar: screenshots at 1440 and 390 in both themes, no horizontal scroll, and nothing
  lost in the move: every one of the signatures in lib/evidence.json is on the page as an explorer link.
  Broken versions:
    BROKEN=dropsig  one signature's row removed                -> "every signature present" fails
    BROKEN=wide     a 2000px element on the page               -> "no horizontal scroll" fails
*/
const BROKEN = process.env.BROKEN ?? "";
const all: string[] = [];
(function walk(o: unknown) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") { const r = o as Record<string, unknown>; if (typeof r.signature === "string") all.push(r.signature); Object.values(r).forEach(walk); }
})(evidence);
const unique = [...new Set(all)];

async function open(page: Page, width: number, scheme: "light" | "dark") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto("/evidence", { waitUntil: "load" });
  if (BROKEN === "dropsig") await page.evaluate(() => document.querySelector("a[data-signature]")?.closest("tr")?.remove());
  if (BROKEN === "wide") await page.evaluate(() => { const d = document.createElement("div"); d.style.width = "2000px"; d.style.height = "4px"; document.querySelector("#sources")!.appendChild(d); });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`evidence ${width} ${scheme}: every signature present, no horizontal scroll`, async ({ page }) => {
      await open(page, width, scheme);
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, `page scrolls sideways: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
      const onPage = new Set(await page.locator("a[data-signature]").evaluateAll((as) => as.map((a) => a.getAttribute("data-signature"))));
      const missing = unique.filter((s) => !onPage.has(s));
      expect(missing, `signatures missing from /evidence: ${missing.map((s) => s.slice(0, 8)).join(", ")}`).toEqual([]);
      mkdirSync("e2e/shots", { recursive: true });
      if (!BROKEN) await page.screenshot({ path: `e2e/shots/evidence-${width}-${scheme}.png`, fullPage: true });
    });
  }
}
