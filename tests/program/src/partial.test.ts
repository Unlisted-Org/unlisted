// Headline: partial redemption when the issuer acts. Every unavailability is a real Token-2022 issuer action
// (pause, transfer hook switched on, vault frozen); every seizure is a real permanent-delegate burn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { kp } from "./env.ts";
import { tokenAmount } from "./fixtures.ts";
import { world, balances, claimValue, fee, World } from "./scenario.ts";

function claimOf(w: World, ticket: any, i: number) {
  return w.c.redemption(ticket).legs[i];
}

test("one leg paused mid-redemption: six legs paid now, the paused leg becomes a claim, settles after resume", () => {
  const w = world("p1");
  const { c, iss, alice } = w;
  const s = c.shares(alice.publicKey) / 2n;
  const S = c.supply();
  const expectPaid = c.mints.map((_, i) => { const out = (s * c.owned(i)) / (S + c.legs()[i].claimUnits); return out - fee(out); });
  iss.pause(c.mints[2]);
  const b0 = balances(w, alice.publicKey);
  const { res, ticket } = c.redeem(alice, s);
  assert.ok(res.ok, res.error);
  const paid = balances(w, alice.publicKey).map((b, i) => b - b0[i]);
  for (let i = 0; i < 7; i++) {
    if (i === 2) assert.equal(paid[i], 0n);
    else assert.equal(paid[i], expectPaid[i], `leg ${i} paid in the same transaction`);
  }
  const created = res.events.filter((e) => e.name === "ClaimCreated");
  assert.equal(created.length, 1);
  assert.equal(created[0].data.leg, 2);
  assert.ok("Paused" in created[0].data.reason);
  assert.equal(BigInt(created[0].data.units.toString()), s);
  assert.equal(c.legs()[2].claimUnits, s);
  assert.equal(c.shares(alice.publicKey), s, "shares burned");
  const redeemed = res.events.find((e) => e.name === "Redeemed")!;
  assert.equal(redeemed.data.claims_mask, 1 << 2);

  // Settlement is refused while paused (by our program, before any transfer), and the claim is untouched.
  const cranker = kp("p1:cranker");
  w.env.fund(cranker.publicKey, 10n ** 9n);
  const early = c.settleClaim(cranker, ticket, alice.publicKey, 2);
  assert.equal(early.error, "LegUnavailable");
  assert.ok(claimOf(w, ticket, 2).Claim);
  // Closing the redemption ticket is refused while a claim is open.
  assert.equal(c.closeRedemption(alice, ticket).error, "OutstandingClaims");

  iss.resume(c.mints[2]);
  const owed = claimValue(w, 2, s);
  assert.equal(owed, expectPaid[2] + fee(owed), "the claim is worth what an unpaused redemption would have paid");
  const before = tokenAmount(w.env, c.userAta(alice.publicKey, c.mints[2]));
  const st = c.settleClaim(cranker, ticket, alice.publicKey, 2); // permissionless: a third party cranks it
  assert.ok(st.ok, st.error);
  assert.equal(tokenAmount(w.env, c.userAta(alice.publicKey, c.mints[2])) - before, expectPaid[2]);
  assert.equal(c.legs()[2].claimUnits, 0n);
  assert.equal(st.events[0].name, "ClaimSettled");
  assert.equal(BigInt(st.events[0].data.amount.toString()), owed, "amount = gross debited from the vault");
  assert.equal(BigInt(st.events[0].data.received.toString()), expectPaid[2], "received = measured net of the fee");
  assert.equal(c.settleClaim(cranker, ticket, alice.publicKey, 2).error, "NoClaim", "a claim settles once");
  assert.ok(c.closeRedemption(alice, ticket).ok);
});

test("several legs unavailable at once (pause, hook, frozen vault): each becomes its own claim with its reason", () => {
  const w = world("p2");
  const { c, iss, alice, bob } = w;
  for (const m of c.mints) iss.mintTo(m, c.userAta(bob.publicKey, m), 10n ** 9n);
  iss.pause(c.mints[1]);
  iss.setHook(c.mints[4], kp("unreviewed-hook").publicKey);
  iss.freeze(c.vaults[6], c.mints[6]);
  // Deposits of any kind are refused while any leg is unavailable.
  assert.equal(c.depositInKind(bob, c.mints.map(() => 10n ** 9n)).error, "LegUnavailable");
  assert.equal(c.openTicket(bob, 1_000_000n).res.error, "LegUnavailable");

  const s = c.shares(alice.publicKey);
  const b0 = balances(w, alice.publicKey);
  const { res, ticket } = c.redeem(alice, s);
  assert.ok(res.ok, res.error);
  const paid = balances(w, alice.publicKey).map((b, i) => b - b0[i]);
  const reasons: Record<number, string> = { 1: "Paused", 4: "Hook", 6: "Frozen" };
  for (let i = 0; i < 7; i++) {
    const tl = claimOf(w, ticket, i);
    if (reasons[i]) {
      assert.equal(paid[i], 0n);
      assert.ok(reasons[i] in tl.Claim.reason, `leg ${i} reason ${JSON.stringify(tl)}`);
    } else {
      assert.ok(paid[i] > 0n && tl.Paid, `leg ${i} paid now`);
    }
  }
  assert.deepEqual(res.events.filter((e) => e.name === "ClaimCreated").map((e) => e.data.leg), [1, 4, 6]);

  // Each claim waits for its own leg only.
  iss.resume(c.mints[1]);
  assert.ok(c.settleClaim(bob, ticket, alice.publicKey, 1).ok, "leg 1 settles after resume");
  assert.equal(c.settleClaim(bob, ticket, alice.publicKey, 4).error, "LegUnavailable", "hook still set");
  assert.equal(c.settleClaim(bob, ticket, alice.publicKey, 6).error, "LegUnavailable", "vault still frozen");
  iss.setHook(c.mints[4], PublicKey.default);
  assert.ok(c.settleClaim(bob, ticket, alice.publicKey, 4).ok, "leg 4 settles after the hook is removed");
  iss.thaw(c.vaults[6], c.mints[6]);
  assert.ok(c.settleClaim(bob, ticket, alice.publicKey, 6).ok, "leg 6 settles after thaw");
  for (let i = 0; i < 7; i++) assert.equal(c.legs()[i].claimUnits, 0n);
  // Deposits are accepted again.
  assert.ok(c.depositInKind(bob, c.mints.map(() => 10n ** 9n)).ok);
});


test("every leg paused: redemption still succeeds, burns the shares and turns every leg into a claim", () => {
  const w = world("p3");
  const { c, iss, alice } = w;
  for (const m of c.mints) iss.pause(m);
  const s = c.shares(alice.publicKey);
  const { res, ticket } = c.redeem(alice, s);
  assert.ok(res.ok, res.error);
  assert.equal(c.shares(alice.publicKey), 0n);
  for (let i = 0; i < 7; i++) assert.equal(BigInt(claimOf(w, ticket, i).Claim.units.toString()), s);
  for (const m of c.mints) iss.resume(m);
  for (let i = 0; i < 7; i++) assert.ok(c.settleClaim(alice, ticket, alice.publicKey, i).ok);
});

test("seizure while a claim is open: the claimant and the holders lose the same fraction; observe emits it", () => {
  // Alice and the seed hold equal thirds of the value... alice deposits exactly the seed's composition.
  const w = world("p4", { fee: 0, bootstrap: 10n ** 12n, aliceGross: 10n ** 12n });
  const { c, iss, alice, seed } = w;
  iss.pause(c.mints[3]);
  const s = c.shares(alice.publicKey);
  const { res, ticket } = c.redeem(alice, s);
  assert.ok(res.ok);
  // The issuer burns half of leg 3 out of the vault while the claim is open. (Pausable blocks burns too,
  // so the issuer resumes, burns and pauses again: all of it signed by the issuer alone.)
  iss.resume(c.mints[3]);
  iss.seize(c.vaults[3], c.mints[3], c.balance(3) / 2n);
  iss.pause(c.mints[3]);
  const obs = c.observe([3]);
  assert.ok(obs.ok);
  const sf = obs.events.find((e) => e.name === "ShortfallObserved")!;
  assert.equal(sf.data.leg, 3);
  assert.equal(BigInt(sf.data.expected.toString()), 2n * 10n ** 12n);
  assert.equal(BigInt(sf.data.actual.toString()), 10n ** 12n);
  iss.resume(c.mints[3]);
  const before = tokenAmount(w.env, c.userAta(alice.publicKey, c.mints[3]));
  assert.ok(c.settleClaim(seed, ticket, alice.publicKey, 3).ok);
  assert.equal(tokenAmount(w.env, c.userAta(alice.publicKey, c.mints[3])) - before, 5n * 10n ** 11n, "claimant takes half the loss");
  assert.equal((c.shares(seed.publicKey) * c.owned(3)) / c.supply(), 5n * 10n ** 11n, "so does the remaining holder");
});

test("USDC mode with a paused leg: PendingSale claims sell through the router at the measured amount; paused leg waits", () => {
  const w = world("p5");
  const { c, iss, alice, bob } = w;
  iss.pause(c.mints[5]);
  const s = c.shares(alice.publicKey) / 4n;
  const { res, ticket } = c.redeem(alice, s, { usdc: 0n });
  assert.ok(res.ok, res.error);
  for (let i = 0; i < 7; i++) {
    const tl = claimOf(w, ticket, i);
    assert.ok((i === 5 ? "Paused" : "PendingSale") in tl.Claim.reason, `leg ${i}`);
  }
  // Leg 0 sells: exactly floor(units × owned / (S + C)) leaves the vault; the owner's USDC delta is measured.
  const amount = claimValue(w, 0, s);
  const usdc0 = tokenAmount(w.env, c.usdcAta(alice.publicKey));
  const v0 = c.balance(0);
  assert.equal(c.settleLegUsdc(alice, ticket, 0, amount, 1234n, 1235n).error, "SlippageExceeded", "min_usdc_out on the measured delta");
  const ok = c.settleLegUsdc(alice, ticket, 0, amount, 1234n, 1234n);
  assert.ok(ok.ok, ok.error);
  assert.equal(v0 - c.balance(0), amount);
  assert.equal(tokenAmount(w.env, c.usdcAta(alice.publicKey)) - usdc0, 1234n);
  // A route that tries to take more than the claim is worth is refused.
  const amount1 = claimValue(w, 1, s);
  assert.equal(c.settleLegUsdc(alice, ticket, 1, amount1 + 1n, 10n, 1n).error, "RouteViolation");
  // Only the owner may settle a PendingSale claim, and in kind only as the fallback.
  assert.equal(c.settleClaim(bob, ticket, alice.publicKey, 1).error, "Unauthorized");
  const b1 = tokenAmount(w.env, c.userAta(alice.publicKey, c.mints[1]));
  assert.ok(c.settleClaim(alice, ticket, alice.publicKey, 1).ok, "no route: settles in kind");
  assert.equal(tokenAmount(w.env, c.userAta(alice.publicKey, c.mints[1])) - b1, amount1 - fee(amount1));
  // The paused leg cannot be sold until it is available; then it can (any claim once available).
  const a5 = claimValue(w, 5, s);
  assert.equal(c.settleLegUsdc(alice, ticket, 5, a5, 10n).error, "LegUnavailable");
  iss.resume(c.mints[5]);
  assert.ok(c.settleLegUsdc(alice, ticket, 5, claimValue(w, 5, s), 10n).ok);
});

test("frozen vault and hook each behave like a pause: refusal to deposit, claim on redeem, settle after", () => {
  for (const kind of ["hook", "freeze"] as const) {
    const w = world("p6" + kind);
    const { c, iss, alice } = w;
    const act = () => (kind === "hook" ? iss.setHook(c.mints[0], kp("h").publicKey) : iss.freeze(c.vaults[0], c.mints[0]));
    const undo = () => (kind === "hook" ? iss.setHook(c.mints[0], PublicKey.default) : iss.thaw(c.vaults[0], c.mints[0]));
    act();
    for (const m of c.mints) iss.mintTo(m, c.userAta(alice.publicKey, m), 10n ** 9n);
    assert.equal(c.depositInKind(alice, c.mints.map(() => 10n ** 9n)).error, "LegUnavailable");
    const { res, ticket } = c.redeem(alice, 10n ** 6n);
    assert.ok(res.ok);
    assert.ok((kind === "hook" ? "Hook" : "Frozen") in claimOf(w, ticket, 0).Claim.reason);
    assert.equal(c.settleClaim(alice, ticket, alice.publicKey, 0).error, "LegUnavailable");
    undo();
    assert.ok(c.settleClaim(alice, ticket, alice.publicKey, 0).ok);
  }
});
