import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

/*
  Holder app proof bar. Logged out unless a test says otherwise: every route must be complete and
  readable without a wallet.
  - Six routes, one job each: every route shows its own content and none of the others'.
  - The sidebar sits flush with the left edge at any width, with even spacing top to bottom.
  - One Connect button; it opens the wallet adapter's modal, styled in the app's tokens, listing the
    wallets this browser actually has; connecting keeps the wallet across routes.
  - Screenshots of every route at 1440 and 390, light and dark. No page-level horizontal scroll.
  - No motion in the app, even when the viewer allows it.
  - The landing page's "Open app" link reaches the app.

  Broken versions (each must fail before the real run is relied on):
    BROKEN=merged    another route's content shown on every route       -> the one-job-per-route check fails
    BROKEN=centred   the frame re-centred in a 1440px column            -> the flush-sidebar check fails
    BROKEN=uneven    one sidebar item given extra margin                -> the even-spacing check fails
    BROKEN=nowallet  no wallet injected into the browser                -> the modal lists no test wallet
    BROKEN=unstyled  the modal's panel forced to the library's colour   -> the styled-modal check fails
    BROKEN=twobuttons  a second connect button added to the header      -> "one Connect button" fails
    BROKEN=wide      a 2000px element on the Overview                   -> no horizontal scroll fails
    BROKEN=hide      the Overview's company tiles hidden                -> the route check fails
    BROKEN=motion    an animation inside the app                        -> no motion fails
    BROKEN=404       the landing link points at a missing route         -> the app link check fails
    BROKEN=allvalues the value expander open by default (Basket)        -> "one value leads" fails
    BROKEN=costfirst the cost box moved above the buy action (Buy)      -> "buy box leads with the action" fails
    BROKEN=nopaging  eleven entries shown in an event list (History)    -> "logs are paged" fails
    BROKEN=orphan    the tiles back on an auto-fill grid                -> "seven across or one per row" fails
*/
const BROKEN = process.env.BROKEN ?? "";
const SHOTS = "e2e/shots";

// Each route's own content, and the testid that marks it. A route must show its own and no other's.
const ROUTES = [
  { path: "/app", nav: "overview", own: "tiles" },
  { path: "/app/buy", nav: "buy", own: "deposit" },
  { path: "/app/sell", nav: "sell", own: "redeem" },
  { path: "/app/claims", nav: "claims", own: "claims" },
  { path: "/app/basket", nav: "basket", own: "legs-table" },
  { path: "/app/history", nav: "history", own: "issuer-activity" },
] as const;

async function frame(page: Page, width: number, scheme: "light" | "dark", reducedMotion: "reduce" | "no-preference" = "no-preference") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
}

async function breakPage(page: Page) {
  if (BROKEN === "centred") await page.addStyleTag({ content: ".holder > div.grid{max-width:1440px;margin:0 auto}" });
  if (BROKEN === "uneven") await page.addStyleTag({ content: "[data-testid=nav-claims]{margin-top:14px}" });
  if (BROKEN === "hide") await page.addStyleTag({ content: "[data-testid=tiles]{display:none!important}" });
}

async function routeReady(page: Page, own: string) {
  // The Overview and the routes read devnet; the Basket's values come from the valuation API, which can be slow cold.
  await expect(page.getByTestId(own)).toBeVisible({ timeout: BROKEN ? 30_000 : 120_000 });
}

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`app ${width} ${scheme}: six routes, one job each, logged out, no horizontal scroll`, async ({ page }) => {
      test.setTimeout(600_000);
      await frame(page, width, scheme);
      await page.goto("/app", { waitUntil: "load" });
      await breakPage(page);
      mkdirSync(SHOTS, { recursive: true });
      for (const r of ROUTES) {
        await page.getByTestId(`nav-${r.nav}`).click();
        await expect(page, `the ${r.nav} link`).toHaveURL(new RegExp(`${r.path.replace(/\//g, "\\/")}$`));
        await routeReady(page, r.own);
        if (BROKEN === "merged" && r.own !== "legs-table") await page.evaluate(() => { const d = document.createElement("div"); d.dataset.testid = "legs-table"; d.textContent = "legs"; document.querySelector("main")!.appendChild(d); });
        for (const other of ROUTES) if (other.own !== r.own) await expect(page.getByTestId(other.own), `${other.own} on ${r.path}`).toHaveCount(0);
        await expect(page.getByTestId(`nav-${r.nav}`)).toHaveAttribute("aria-current", "page");
        if (BROKEN === "wide" && r.path === "/app") await page.evaluate(() => { const d = document.createElement("div"); d.style.width = "2000px"; d.style.height = "4px"; document.querySelector("[data-testid=tiles]")!.appendChild(d); });
        const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(sw, `${r.path} scrolls sideways: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
        if (r.path === "/app/basket") await expect(page.getByTestId("value-sell-now")).toContainText(/\$\d/, { timeout: 240_000 });
        if (r.path === "/app") {
          await expect(page.locator("[data-testid^='tile-state-']")).toHaveCount(7);
          await expect(page.getByTestId("position")).toContainText("Connect a wallet");
          await expect(page.getByTestId("issuer-control")).toBeVisible();
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        if (!BROKEN) await page.screenshot({ path: `${SHOTS}/app-${r.nav}-${width}-${scheme}.png`, fullPage: true });
      }
      // A direct load of each route answers 200 (they are real routes, not client-only states).
      for (const r of ROUTES) expect((await page.request.get(r.path)).status(), `GET ${r.path}`).toBe(200);
    });
  }
}

test("app: the sidebar is flush left at any width, evenly spaced top to bottom", async ({ page }) => {
  test.setTimeout(300_000);
  for (const width of [1024, 1440, 1920, 2560]) {
    await frame(page, width, "light");
    await page.goto("/app", { waitUntil: "load" });
    await breakPage(page);
    await expect(page.getByTestId("connect-wallet")).toBeVisible({ timeout: 60_000 }); // the real frame, not the loading one
    const nav = (await page.getByTestId("app-nav").boundingBox())!;
    expect(nav.x, `sidebar left edge at ${width}px`).toBe(0);
    const ys = await page.locator("[data-testid=app-nav] a").evaluateAll((as) => as.map((a) => a.getBoundingClientRect().top));
    const gaps = ys.slice(1).map((y, i) => Math.round((y - ys[i]) * 10) / 10);
    expect(new Set(gaps).size, `sidebar item spacing at ${width}px: ${gaps.join(", ")}`).toBe(1);
  }
});

test("app: one Connect button opens a styled wallet modal listing the wallets this browser has", async ({ page }) => {
  test.setTimeout(300_000);
  await frame(page, 1440, "dark");
  const kp = Keypair.generate(); // never funded: connecting needs no transaction
  if (BROKEN !== "nowallet") {
    await page.addInitScript(`window.__UNLISTED_TEST_WALLET_SECRET__ = ${JSON.stringify([...kp.secretKey])};`);
    await page.addInitScript({ path: join(__dirname, "holder/.build/test-wallet.js") });
  }
  await page.goto("/app", { waitUntil: "load" });
  await expect(page.getByTestId("connect-wallet")).toBeVisible({ timeout: 60_000 });
  if (BROKEN === "twobuttons") await page.evaluate(() => { const b = document.createElement("button"); b.textContent = "Connect Phantom"; document.querySelector("header")!.appendChild(b); });
  if (BROKEN === "unstyled") await page.addStyleTag({ content: ".wallet-adapter-modal-wrapper{background:#2c2d30!important}" });
  await expect(page.locator("header").getByRole("button", { name: /connect/i }), "connect buttons in the header").toHaveCount(1);
  await page.getByTestId("connect-wallet").click();
  const modal = page.locator(".wallet-adapter-modal-wrapper");
  await expect(modal).toBeVisible();
  // Styled in the app's tokens: the panel is the app's surface colour, not the library's default.
  const [panel, surface] = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--surface)";
    document.querySelector(".holder")!.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(document.querySelector(".wallet-adapter-modal-wrapper")!).backgroundColor, want];
  });
  expect(panel, "modal panel colour").toBe(surface);
  const item = modal.getByRole("button", { name: /Unlisted Test Wallet/ });
  await expect(item, "the injected wallet is listed").toBeVisible({ timeout: 5_000 });
  await expect(item).toContainText("Detected");
  await page.screenshot({ path: `${SHOTS}/app-wallet-modal-1440-dark.png` });
  await item.click();
  await expect(page.getByTestId("wallet-address")).toHaveAttribute("data-address", kp.publicKey.toBase58());
  // The wallet stays connected across routes (one provider around all of them).
  await page.getByTestId("nav-basket").click();
  await expect(page).toHaveURL(/\/app\/basket$/, { timeout: 15_000 }); // a cold deploy loads the route's code on first visit
  await expect(page.getByTestId("wallet-address")).toHaveAttribute("data-address", kp.publicKey.toBase58());
  await page.getByTestId("wallet-connected").click();
  await page.getByTestId("wallet-disconnect").click();
  await expect(page.getByTestId("connect-wallet")).toBeVisible();
});

test("app: no motion, even when the viewer allows it", async ({ page }) => {
  test.setTimeout(300_000);
  await frame(page, 1440, "dark", "no-preference");
  await page.goto("/app", { waitUntil: "load" });
  await routeReady(page, "tiles");
  if (BROKEN === "motion") await page.evaluate(() => { document.querySelector("[data-testid=tiles]")!.animate([{ opacity: 1 }, { opacity: 0.3 }], { duration: 60_000, iterations: Infinity }); });
  for (const r of ROUTES) {
    await page.getByTestId(`nav-${r.nav}`).click();
    await routeReady(page, r.own);
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 700) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(40); }
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(running, `animations running on ${r.path}`).toBe(0);
    if (BROKEN === "motion") break;
  }
  const transition = await page.evaluate(() => getComputedStyle(document.querySelector("main button, main a")!).transitionDuration);
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
  await link.click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 60_000 });
});

test("app (Basket): one value leads, the other two are folded", async ({ page }) => {
  test.setTimeout(300_000);
  await frame(page, 1440, "light");
  await page.goto("/app/basket", { waitUntil: "load" });
  await expect(page.getByTestId("value-sell-now")).toContainText(/\$\d/, { timeout: 240_000 });
  if (BROKEN === "allvalues") await page.evaluate(() => document.querySelector("[data-testid=value-more]")?.setAttribute("open", ""));
  await expect(page.getByTestId("value-last-trade"), "last trade folded by default").toBeHidden();
  await expect(page.getByTestId("value-reference"), "reference folded by default").toBeHidden();
  await page.getByTestId("value-more").locator(":scope > summary").click();
  for (const id of ["value-last-trade", "value-reference"]) await expect(page.getByTestId(id)).toContainText(/\$\d/);
});

test("app (Buy): the buy box leads with the action, the cost follows it", async ({ page }) => {
  test.setTimeout(300_000);
  await frame(page, 1440, "dark");
  await page.goto("/app/buy", { waitUntil: "load" });
  await routeReady(page, "deposit");
  if (BROKEN === "costfirst") await page.evaluate(() => { const c = document.querySelector("[data-testid=cost-box]"); const d = document.querySelector("[data-testid=deposit]"); if (c && d) d.insertBefore(c, d.children[1]); });
  const order = await page.evaluate(() => {
    const btn = document.querySelector("[data-testid=inkind-submit]")!, cost = document.querySelector("[data-testid=cost-box]")!;
    return btn.compareDocumentPosition(cost) & Node.DOCUMENT_POSITION_FOLLOWING ? "button, then cost" : "cost, then button";
  });
  expect(order).toBe("button, then cost");
  await expect(page.getByTestId("cost-box")).toContainText("never cheaper");
});

test("app (History): event logs are paged, ten at a time", async ({ page }) => {
  test.setTimeout(300_000);
  await frame(page, 1440, "light");
  await page.goto("/app/history", { waitUntil: "load" });
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

// The demo's server routes refuse what they must, before touching the chain. (No key is configured for
// this run, so a request that got past the gate would answer 503, not 403: the gate is what's tested.)
test("api: the issuer control refuses a wrong or missing passcode; the faucet refuses a bad wallet", async ({ request }) => {
  test.skip(process.env.E2E_ENV === "devnet", "the devnet run configures the issuer key; this check runs without it");
  for (const passcode of ["wrong", "", undefined]) {
    const r = await request.post("/api/issuer", { data: { action: "pause", symbol: "ANTHROPIC", passcode } });
    expect(r.status(), `passcode ${JSON.stringify(passcode)}`).toBe(403);
  }
  expect((await request.post("/api/faucet", { data: { wallet: "not-a-key" } })).status()).toBe(400);
  expect((await request.get("/api/issuer")).status()).toBe(405);
});

test("app (Overview): the seven tiles are seven across or one per row, never an orphan", async ({ page }) => {
  test.setTimeout(300_000);
  for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
    await frame(page, width, "light");
    await page.goto("/app", { waitUntil: "load" });
    await routeReady(page, "tiles");
    if (BROKEN === "orphan") await page.addStyleTag({ content: ".holder .tiles{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))!important}" });
    const tops = await page.locator("[data-testid=tiles] > li").evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().top)));
    const rows = new Set(tops).size;
    expect([1, 7], `tile rows at ${width}px: ${rows}`).toContain(rows);
  }
});
