import { test, expect, request as pwRequest } from "@playwright/test";
import evidence from "../lib/evidence.json";

/*
  Logged-out link check. Run with LINKS=1 (network-heavy, so not part of the default run).
  - Every signature in lib/evidence.json (36) opens on the Solana Explorer, in a fresh
    context with no cookies, and shows the transaction as Success and Finalized.
  - Every github.com link on the rendered landing page returns 200 to an unauthenticated
    request (the repo must be public).

  Broken version: BROKEN_LINKS=1 adds a well-formed signature that doesn't exist on chain and a
  record path that doesn't exist in the repo; both must fail.
*/
test.skip(!process.env.LINKS, "set LINKS=1 to run the logged-out link check");

type Sig = { signature: string; network: "devnet" | "mainnet" };
const sigs: Sig[] = [];
(function walk(o: unknown) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    if (typeof r.signature === "string") sigs.push({ signature: r.signature, network: r.network as Sig["network"] });
    Object.values(r).forEach(walk);
  }
})(evidence);
const unique = [...new Map(sigs.map((s) => [s.signature, s])).values()];
if (process.env.BROKEN_LINKS)
  unique.push({ signature: "4uRBN9XKeJR8CeaNSNLWyfUWy77wrNUorXkmR5d5dR9a4SqMt8V66T688dQUtfJrNjNwuYscwXE28U6ttcMKSzh1", network: "devnet" });

test.describe.configure({ mode: "serial" });

test(`all ${unique.length} evidence signatures resolve on the explorer, logged out`, async ({ browser }) => {
  test.setTimeout(unique.length * 45_000);
  const ctx = await browser.newContext(); // fresh: no cookies, no storage, no wallet
  const page = await ctx.newPage();
  const failures: string[] = [];
  for (const s of unique) {
    const url = `https://explorer.solana.com/tx/${s.signature}${s.network === "devnet" ? "?cluster=devnet" : ""}`;
    await page.goto(url, { waitUntil: "load" });
    const ok = page.getByText("Finalized", { exact: false }).first();
    const missing = page.getByText("Not Found", { exact: false }).first();
    const outcome = await Promise.race([
      ok.waitFor({ timeout: 30_000 }).then(() => "finalized"),
      missing.waitFor({ timeout: 30_000 }).then(() => "not found"),
    ]).catch(() => "timeout");
    const body = await page.locator("body").innerText();
    if (outcome !== "finalized" || !body.includes("Success")) failures.push(`${s.network} ${s.signature}: ${outcome}`);
  }
  await ctx.close();
  expect(failures, failures.join("\n")).toEqual([]);
});

test("every GitHub link on the landing page resolves without logging in", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  let hrefs = await page.$$eval("a[href^='https://github.com']", (as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
  if (process.env.BROKEN_LINKS) hrefs = [...hrefs, "https://github.com/Unlisted-Org/unlisted/blob/main/docs/does-not-exist.md"];
  const anon = await pwRequest.newContext({ extraHTTPHeaders: {} }); // no credentials
  const failures: string[] = [];
  for (const h of hrefs) {
    const r = await anon.get(h, { maxRedirects: 5 });
    if (r.status() !== 200) failures.push(`${r.status()} ${h}`);
  }
  await anon.dispose();
  console.log(`checked ${hrefs.length} GitHub links`);
  expect(failures, failures.join("\n")).toEqual([]);
});
