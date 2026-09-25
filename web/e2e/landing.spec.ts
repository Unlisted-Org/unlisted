import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/*
  Landing page proof bar.
  - Screenshots at 1440 and 390, light and dark, with no wallet present.
  - No page-level horizontal scroll.
  - Every section's key text visible with no wallet.
  - Reduced motion: no running animations after a full scroll, and each animated element in its final state.
  - Reduced motion: every section is complete at rest (all terminal lines printed, all outcomes shown).
  - The hero card is straight (no tilt), and with motion allowed it plays in once and stops.
  - "Basket protocols break": no Replay control; the terminal plays once when scrolled into view, the four
    steps advance in order as it plays, and it stops on the last one (never loops).

  Broken versions (run each and see it fail before relying on the check):
    BROKEN=wide    a 2000px-wide element inside a section         -> "no horizontal scroll" fails
    BROKEN=hide    the survival section hidden                      -> "readable without a wallet" fails
    BROKEN=motion  a component animating despite reduced motion     -> "reduced motion" fails
    BROKEN=blank   the terminal emptied under reduced motion          -> "complete at rest" fails
    BROKEN=tilt    the hero card rotated in 3D                        -> "the hero card is straight" fails
    BROKEN=nohero  the hero card's entrance removed                   -> "plays in once" fails
    BROKEN=replay  a Replay button added to the section               -> "no Replay control" fails
    (mutants, scripts/mutant.mjs: the run never starting on scroll, and the run looping back to the first
     step, each fail "plays once when scrolled into view")
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
  if (BROKEN === "tilt") await page.addStyleTag({ content: "[data-testid=receipt]{transform:perspective(1600px) rotateX(10deg) rotateY(-8deg)!important}" });
  if (BROKEN === "nohero") await page.addStyleTag({ content: ".receipt-enter,.receipt-row,.receipt-claim td{animation:none!important}" });
  if (BROKEN === "replay") await page.evaluate(() => { const b = document.createElement("button"); b.textContent = "Replay"; document.querySelector("#breaks")!.appendChild(b); });
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

test("reduced motion: every section is complete at rest", async ({ page }) => {
  await open(page, 1440, "light", "reduce");
  const lines = page.locator("#breaks .whitespace-pre-wrap");
  // The first run (Symmetry, pause) is printed in full: 4 commands + 5 output lines.
  expect(await lines.count(), "terminal lines at rest").toBeGreaterThanOrEqual(9);
  await expect(page.locator("#breaks")).toContainText("received: nothing");
  for (const [id, text] of [["sym-pause", "Receives nothing"], ["unl-pause", "6 of 7 legs paid immediately"], ["sym-seize", "fails and pays nothing"], ["unl-seize", "shared pro rata"]])
    await expect(page.locator(`[data-outcome="${id}"]`)).toContainText(text);
  await expect(page.locator("#happened svg path").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay" })).toHaveCount(0);
  writeFileSync(`${SHOTS}/.gitkeep`, "");
});

test("the hero card is straight: no tilt, at rest or in motion", async ({ page }) => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await open(page, 1440, "light", reducedMotion);
    await page.waitForTimeout(2200); // past the entrance
    const r = await page.getByTestId("receipt").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const turned: string[] = [];
      for (let n: Element | null = el; n && n.tagName !== "SECTION"; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const flat = cs.transform === "none" || cs.transform === "matrix(1, 0, 0, 1, 0, 0)"; // identity: the entrance's end state
        if (!flat || cs.rotate !== "none" || cs.perspective !== "none") turned.push(`${n.tagName}.${n.className.toString().slice(0, 30)}: ${cs.transform} ${cs.rotate}`);
      }
      return { dw: Math.abs(box.width - (el as HTMLElement).offsetWidth), dh: Math.abs(box.height - (el as HTMLElement).offsetHeight), turned };
    });
    expect(r.turned, `transformed ancestors (${reducedMotion})`).toEqual([]);
    expect(r.dw + r.dh, `bounding box vs layout size (${reducedMotion})`).toBeLessThan(1);
  }
});

test("the hero card plays in once with motion allowed, then stops", async ({ page }) => {
  await open(page, 1440, "light", "no-preference");
  // Several animations run on the card and its rows right after load (the page was opened ~0.3 s ago).
  const n = await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect)?.target instanceof Element && ((a.effect as KeyframeEffect).target as Element).closest("[data-testid=receipt]")).length);
  expect(n, "entrance animations on the hero card").toBeGreaterThanOrEqual(8);
  await page.waitForTimeout(2500);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && ((a.effect as KeyframeEffect)?.target as Element)?.closest?.("[data-testid=receipt]")).length);
  expect(running, "animations still running on the card after 2.8 s").toBe(0);
  expect(await page.getByTestId("receipt").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("Basket protocols break: no Replay; plays once on scroll, steps advance in order, never loops", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, 1440, "light", "no-preference");
  const run = page.locator("#breaks [data-run]");
  await expect(page.locator("#breaks").getByRole("button", { name: /replay/i }), "no Replay control").toHaveCount(0);
  // Out of view: nothing has played yet.
  await expect(run).toHaveAttribute("data-run", "playing");
  await expect(page.locator("#breaks [data-phase]")).toHaveAttribute("data-phase", "idle");
  // Scroll it into view, then watch which step is current until the run finishes.
  await page.locator("#breaks [data-phase]").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector("#breaks [data-phase]")!.scrollIntoView({ block: "center" }));
  const seen: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const cur = await page.locator("#breaks li[aria-current=step]").getAttribute("data-step").catch(() => null);
    if (cur && seen[seen.length - 1] !== cur) seen.push(cur);
    if ((await run.getAttribute("data-run")) === "finished" || seen.length > 4) break;
    await page.waitForTimeout(150);
  }
  expect(seen, "steps, in the order they played").toEqual(["sym-pause", "unl-pause", "sym-seize", "unl-seize"]);
  await expect(run).toHaveAttribute("data-run", "finished");
  const term = page.locator("#breaks [data-phase]");
  await expect(term).toHaveAttribute("data-phase", "done");
  await expect(term).toContainText("six legs in full");
  // It stays finished: same step, same text, nothing animating in the section.
  const text = await term.innerText();
  await page.waitForTimeout(3000);
  await expect(page.locator("#breaks li[aria-current=step]")).toHaveAttribute("data-step", "unl-seize");
  expect(await term.innerText(), "terminal text 3 s after the end").toBe(text);
  await expect(run).toHaveAttribute("data-run", "finished");
  if (!BROKEN) await page.locator("#breaks").screenshot({ path: `${SHOTS}/landing-breaks-finished-1440-light.png` });
});
