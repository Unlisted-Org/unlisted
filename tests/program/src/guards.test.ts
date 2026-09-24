// Guards: router allowlist and timelock, measured deltas (never trusting the router), route confinement,
// authority limits, IPO timelocks, init checks, ticket lifecycle, harvest, fee change mid-ticket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import { IDL, ROUTER_ID, Svm, T22, TOKEN, kp, u64le } from "./env.ts";
import { Issuer, LEG_NAMES, tokenAmount, withheld, U64_MAX } from "./fixtures.ts";
import { BasketClient } from "./basket.ts";
import { world, claimValue, fee } from "./scenario.ts";

test("router allowlist: unknown router refused; propose → 48 h timelock → activate; removal immediate", () => {
  const w = world("g1");
  const { c, env, bob } = w;
  const t = c.openTicket(bob, 7_000_000n);
  assert.ok(t.res.ok, t.res.error);
  const fake = kp("fake-router").publicKey;
  const r1 = c.send([c.ticketSwapLegIx(bob.publicKey, t.ticket, 0, 1n, 1n, 10n ** 9n, undefined, fake)], [bob]);
  assert.equal(r1.error, "RouterNotAllowed");
  // Only the authority can propose.
  assert.equal(c.authorityIx("propose_router", { router: fake }, bob).error, "Unauthorized");
  const p = c.authorityIx("propose_router", { router: fake });
  assert.ok(p.ok);
  assert.equal(p.events[0].name, "RouterProposed");
  assert.equal(c.authorityIx("activate_router", { router: fake }).error, "RouterNotPending", "timelock not over");
  env.warp({ seconds: 48 * 3600 });
  assert.ok(c.authorityIx("activate_router", { router: fake }).ok);
  assert.ok(c.state().router_allowlist.some((k: PublicKey) => k.equals(fake)));
  assert.ok(c.authorityIx("remove_router", { router: ROUTER_ID }).ok);
  assert.equal(c.ticketSwapLeg(bob, t.ticket, 0, 1n, 1n, 10n ** 9n).error, "RouterNotAllowed", "removed immediately");
});

test("measured delta, not the router's word: min_out is checked against what actually landed net of the fee", () => {
  const w = world("g2");
  const { c, bob } = w;
  const t = c.openTicket(bob, 7_000_000n);
  const gross = 10n ** 9n;
  // The router 'quotes' the gross amount (as Manifest does); the vault receives gross − 1 % fee.
  assert.equal(c.ticketSwapLeg(bob, t.ticket, 0, 1n, gross, gross).error, "SlippageExceeded");
  const ok = c.ticketSwapLeg(bob, t.ticket, 0, 1n, gross - fee(gross), gross);
  assert.ok(ok.ok, ok.error);
  assert.equal(BigInt(c.state().legs[0].pending_norm.toString()), (gross - fee(gross)) * 10n ** 18n / 10n ** 18n);
  // A route that spends more escrow than usdc_amount is refused.
  const over = c.send([c.ticketSwapLegIx(bob.publicKey, t.ticket, 1, 1n, 1n, gross, c.route(t.ticket, t.escrow, c.usdc, c.vaults[1], c.mints[1], 2n, gross))], [bob]);
  assert.equal(over.error, "RouteViolation");
});

test("basket-signed routes are confined: another leg's vault, a hostile approve, or over-selling are refused", () => {
  const w = world("g3");
  const { c, alice } = w;
  const s = c.shares(alice.publicKey) / 2n;
  const { ticket } = c.redeem(alice, s, { usdc: 0n });
  const amount = claimValue(w, 0, s);
  // Route touching leg 1's vault while settling leg 0.
  const evil = c.route(c.basket, c.vaults[1], c.mints[1], c.usdcAta(alice.publicKey), c.usdc, amount, 1n);
  assert.equal(c.settleLegUsdc(alice, ticket, 0, 0n, 0n, 1n, evil).error, "RouteViolation");
  // Hostile router instruction: approve a delegate on the vault with the basket's signature.
  const approve = { accounts: [
    { pubkey: c.basket, isSigner: false, isWritable: false }, { pubkey: c.vaults[0], isSigner: false, isWritable: true },
    { pubkey: kp("thief").publicKey, isSigner: false, isWritable: false }, { pubkey: T22, isSigner: false, isWritable: false },
  ], data: Buffer.concat([Buffer.from([1]), u64le(10n ** 12n)]) };
  assert.equal(c.settleLegUsdc(alice, ticket, 0, 0n, 0n, 0n, approve).error, "RouteViolation");
  // Selling one unit more than the claim is worth.
  assert.equal(c.settleLegUsdc(alice, ticket, 0, amount + 1n, 5n).error, "RouteViolation");
  assert.ok(c.settleLegUsdc(alice, ticket, 0, amount, 5n).ok);
});

test("authority: can stop new deposits only; redemption and claims keep working; no instruction moves vault tokens", () => {
  const w = world("g4");
  const { c, iss, alice, bob } = w;
  assert.ok(c.authorityIx("set_deposits_enabled", { enabled: false }).ok);
  for (const m of c.mints) iss.mintTo(m, c.userAta(bob.publicKey, m), 10n ** 9n);
  assert.equal(c.depositInKind(bob, c.mints.map(() => 10n ** 9n)).error, "DepositsDisabled");
  assert.equal(c.openTicket(bob, 1n).res.error, "DepositsDisabled");
  assert.ok(c.redeem(alice, 10n ** 6n).res.ok, "redemption unaffected");
  assert.equal(c.authorityIx("set_deposits_enabled", { enabled: true }, bob).error, "Unauthorized");
  const authorityIxs = (IDL as any).instructions.filter((i: any) => i.accounts.some((a: any) => a.name === "authority")).map((i: any) => i.name).sort();
  assert.deepEqual(authorityIxs, ["activate_router", "cancel_listing", "flag_listing", "initialize_basket", "propose_router", "remove_router", "set_deposits_enabled"]);
});

test("bootstrap: authority only, once; deposits need a bootstrapped basket", () => {
  const env = new Svm();
  const iss = new Issuer(env);
  const mints = LEG_NAMES.map((n) => iss.createLegMint(n, 100, 1, kp("g5b:" + n)));
  const usdc = iss.createUsdc(kp("g5b:usdc"));
  const seed = kp("g5b:seed"), mallory = kp("g5b:mallory");
  const { client: c } = BasketClient.create(env, iss, mints, usdc, { label: "g5b", authority: seed });
  for (const u of [seed, mallory]) { c.setupUser(u); for (const m of mints) iss.mintTo(m, c.userAta(u.publicKey, m), 10n ** 12n); }
  assert.equal(c.depositInKind(mallory, mints.map(() => 10n ** 9n)).error, "NotBootstrapped");
  assert.equal(c.bootstrap(mints.map(() => 1n), 10n ** 9n, mallory).error, "Unauthorized");
  assert.equal(c.bootstrap(mints.map(() => 1n).slice(0, 6), 10n ** 9n).error, "MathOverflow", "Vec length must equal n_legs");
  assert.ok(c.bootstrap(mints.map(() => 10n ** 9n), 10n ** 9n).ok);
  assert.equal(c.bootstrap(mints.map(() => 10n ** 9n), 10n ** 9n).error, "AlreadyBootstrapped");
});

test("initialize_basket refuses a mint without the PreStocks extension set, and one with a hook set", () => {
  const w = world("g6");
  const { env, iss } = w;
  // Plain Token-2022 mint (no extensions).
  const plain = kp("g6:plain");
  const lamports = env.svm.minimumBalanceForRentExemption(82n);
  assert.ok(env.send([
    SystemProgram.createAccount({ fromPubkey: env.payer.publicKey, newAccountPubkey: plain.publicKey, space: 82, lamports: Number(lamports), programId: T22 }),
    spl.createInitializeMint2Instruction(plain.publicKey, 9, iss.key.publicKey, null, T22),
  ], [plain]).ok);
  const good = LEG_NAMES.slice(0, 6).map((n) => iss.createLegMint(n, 100, 1, kp("g6:" + n)));
  const r1 = BasketClient.create(env, iss, [...good, plain.publicKey], w.usdc, { label: "g6a", fundPools: false });
  assert.equal(r1.res.error, "UnexpectedExtensionSet");
  const hooked = iss.createLegMint("HOOKED", 100, 1, kp("g6:hooked"));
  iss.setHook(hooked, kp("g6:hookprog").publicKey);
  const r2 = BasketClient.create(env, iss, [...good, hooked], w.usdc, { label: "g6b", fundPools: false });
  assert.equal(r2.res.error, "HookNotNull");
});

test("IPO rule: ≥ 7 d notice and margin; conversion waits for convert_after; chunk cap; cancel only before", () => {
  const w = world("g7", { maxConvertChunk: 10n ** 11n });
  const { c, env } = w;
  const now = env.clock().unixTimestamp;
  const D = 24n * 3600n;
  assert.equal(c.flagListing(2, now + 6n * D, now + 20n * D).error, "ListingNoticeTooShort");
  assert.equal(c.flagListing(2, now + 7n * D, now + 13n * D).error, "ListingNoticeTooShort");
  const f = c.flagListing(2, now + 7n * D, now + 14n * D);
  assert.ok(f.ok);
  assert.equal(f.events[0].name, "LegListing");
  assert.equal(c.convert(2, 10n ** 9n, 10n).error, "ConversionNotOpen");
  env.warp({ seconds: Number(7n * D) });
  assert.equal(c.authorityIx("cancel_listing", { leg: 2 }).error, "ConversionNotOpen", "cannot cancel once open");
  assert.equal(c.convert(2, 10n ** 11n + 1n, 10n).error, "ChunkTooLarge");
  // Chunked conversion until the leg is empty, then Retired; reinvest in equal slices.
  let chunks = 0;
  while (c.owned(2) > 0n) {
    const amt = c.owned(2) < 10n ** 11n ? c.owned(2) : 10n ** 11n;
    const r = c.convert(2, amt, amt / 1000n + 1n);
    assert.ok(r.ok, r.error);
    chunks++;
  }
  assert.ok(chunks >= 15);
  assert.equal(c.legs()[2].status, "Retired");
  assert.equal(c.state().reinvest_mask, 0b1111011);
  const reserve = tokenAmount(env, c.reserve);
  assert.equal(c.reinvest(0, reserve / 6n + 1n, 10n ** 9n).error, "InvalidArgument", "slice is exact");
  for (const [k, i] of [0, 1, 3, 4, 5, 6].entries()) {
    const r0 = tokenAmount(env, c.reserve);
    const slice = k === 5 ? r0 : r0 / BigInt(6 - k);
    assert.ok(c.reinvest(i, slice, 10n ** 9n).ok);
  }
  assert.equal(tokenAmount(env, c.reserve), 0n);
  assert.equal(c.state().reinvest_mask, 0);
  // A retired leg needs no accounts: redemption passes only the six active legs.
  assert.ok(c.redeem(w.alice, 10n ** 6n).res.ok);
});

test("deposit ticket lifecycle: expiry, incomplete finalize, unwind + abort refund, intermediates closed to owner", () => {
  const w = world("g8");
  const { c, env, iss, bob } = w;
  const usdc0 = tokenAmount(env, c.usdcAta(bob.publicKey));
  const t = c.openTicket(bob, 7_000_000n, 10);
  assert.ok(t.res.ok);
  assert.equal(tokenAmount(env, t.escrow), 7_000_000n);
  assert.ok(c.ticketSwapLeg(bob, t.ticket, 0, 1_000_000n, 1n, 10n ** 9n).ok);
  assert.equal(c.finalize(bob, t.ticket).error, "TicketIncomplete");
  env.warp({ slots: 11 });
  assert.equal(c.ticketSwapLeg(bob, t.ticket, 1, 1_000_000n, 1n, 10n ** 9n).error, "TicketExpired");
  assert.equal(c.abort(bob, t.ticket).error, "LegsStillLanded");
  // Unwind leg 0: exactly the ticket's landed amount leaves the vault, USDC comes back into the escrow.
  const landed = 10n ** 9n - fee(10n ** 9n);
  const v0 = c.balance(0);
  assert.ok(c.unwindLeg(bob, t.ticket, 0, landed, 990_000n, 990_000n).ok);
  assert.equal(v0 - c.balance(0), landed);
  assert.equal(c.legs()[0].pendingNorm, 0n);
  // Ticket-owned intermediate token accounts (as a Jupiter route_v2 may list) are closed with rent to the owner.
  const inter1 = iss.ata(t.ticket, c.mints[0], T22);
  const inter2 = iss.ata(t.ticket, kp("g8:wsol-like").publicKey, TOKEN);
  const wsolLike = iss.createUsdc(kp("g8:wsol-like"));
  assert.ok(env.send([iss.createAtaIx(t.ticket, c.mints[0], T22), iss.createAtaIx(t.ticket, wsolLike, TOKEN)]).ok);
  const lam0 = env.account(bob.publicKey)!.lamports;
  const ab = c.abort(bob, t.ticket, [inter1, inter2]);
  assert.ok(ab.ok, ab.error + ab.logs.join("\n"));
  assert.equal(env.account(inter1), null);
  assert.equal(env.account(inter2), null);
  assert.equal(env.account(t.ticket), null);
  assert.ok(env.account(bob.publicKey)!.lamports > lam0, "rent refunded to the owner");
  assert.equal(tokenAmount(env, c.usdcAta(bob.publicKey)), usdc0 - 1_000_000n + 990_000n);
  assert.equal(inter2.equals(iss.ata(t.ticket, wsolLike, TOKEN)), true);
});

test("full USDC ticket: 7 legs land, finalize mints by the spec formula, refunds and closes; fee change mid-ticket", () => {
  const w = world("g9");
  const { c, env, iss, bob } = w;
  const t = c.openTicket(bob, 7_000_000n);
  for (let i = 0; i < 4; i++) assert.ok(c.ticketSwapLeg(bob, t.ticket, i, 1_000_000n, 1n, 10n ** 9n).ok);
  // PreStocks changes the fee while the ticket is open (100 → 300 bps, effective two epochs later).
  for (const m of c.mints) iss.setFee(m, 300);
  env.warp({ epochs: 2 });
  for (let i = 4; i < 7; i++) assert.ok(c.ticketSwapLeg(bob, t.ticket, i, 1_000_000n, 1n, 10n ** 9n).ok);
  const deltas = [0, 1, 2, 3, 4, 5, 6].map((i) => 10n ** 9n - fee(10n ** 9n, i < 4 ? 100n : 300n));
  const S = c.supply();
  const expect = deltas.map((d, i) => (d * (S + c.legs()[i].claimUnits)) / (c.balance(i) - d)).reduce((a, b) => (a < b ? a : b));
  const inter = iss.ata(t.ticket, c.mints[3], T22);
  assert.ok(env.send([iss.createAtaIx(t.ticket, c.mints[3], T22)]).ok);
  const f = c.finalize(bob, t.ticket, expect, [inter]);
  assert.ok(f.ok, f.error);
  assert.equal(c.shares(bob.publicKey), expect);
  const minted = f.events.find((e) => e.name === "Minted")!;
  assert.deepEqual(minted.data.deltas.slice(0, 7).map((x: any) => BigInt(x.toString())), deltas);
  assert.ok("Ticket" in minted.data.path);
  assert.equal(env.account(t.ticket), null);
  assert.equal(env.account(t.escrow), null);
  assert.equal(env.account(inter), null);
  for (let i = 0; i < 7; i++) assert.equal(c.legs()[i].pendingNorm, 0n);
  // min_shares one above the result is refused (SlippageExceeded) — checked on a second ticket.
  const t2 = c.openTicket(bob, 7_000_000n);
  for (let i = 0; i < 7; i++) assert.ok(c.ticketSwapLeg(bob, t2.ticket, i, 1_000_000n, 1n, 10n ** 9n).ok);
  assert.equal(c.finalize(bob, t2.ticket, U64_MAX).error, "SlippageExceeded");
});

test("harvest moves the vault's withheld fees to the mint and changes no accounting", () => {
  const w = world("g10");
  const { c, env } = w;
  assert.ok(withheld(env, c.vaults[0]) > 0n, "deposits left withheld fees in the vault");
  const before = c.legs()[0];
  const bal = c.balance(0);
  assert.ok(c.harvest(0).ok);
  assert.equal(withheld(env, c.vaults[0]), 0n);
  assert.equal(c.balance(0), bal);
  assert.deepEqual(c.legs()[0], before);
  const obs = c.observe([0, 1, 2, 3, 4, 5, 6]);
  assert.equal(obs.events.length, 0, "no shortfall or surplus");
});

test("donation is surplus to holders, not to open tickets; observe is permissionless", () => {
  const w = world("g11");
  const { c, iss, bob } = w;
  const t = c.openTicket(bob, 7_000_000n);
  assert.ok(c.ticketSwapLeg(bob, t.ticket, 0, 1n, 1n, 10n ** 9n).ok);
  const pend = c.legs()[0].pendingNorm;
  iss.mintTo(c.mints[0], c.vaults[0], 12345n);
  const r = c.observe([0], bob);
  assert.equal(r.events[0].name, "SurplusObserved");
  assert.equal(c.legs()[0].pendingNorm, pend);
  assert.equal(c.legs()[0].lossIndex, 10n ** 18n);
});
