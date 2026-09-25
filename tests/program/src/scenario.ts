// A fresh basket on fixture mints created by real Token-2022 instructions, bootstrapped and with one holder.
import { Keypair, PublicKey } from "@solana/web3.js";
import { Svm, kp, TOKEN } from "./env.ts";
import { Issuer, LEG_NAMES, tokenAmount } from "./fixtures.ts";
import { BasketClient } from "./basket.ts";

export interface World { env: Svm; iss: Issuer; c: BasketClient; seed: Keypair; alice: Keypair; bob: Keypair; usdc: PublicKey }

export function world(label: string, opts: { fee?: number; bootstrap?: bigint; aliceGross?: bigint; maxConvertChunk?: bigint } = {}): World {
  const env = new Svm();
  const iss = new Issuer(env);
  const mints = LEG_NAMES.map((n, i) => iss.createLegMint(n, opts.fee ?? 100, i === 0 ? 1.4861347 : 1, kp(`${label}:mint:${n}`)));
  const usdc = iss.createUsdc(kp(`${label}:usdc`));
  const seed = kp(`${label}:seed`);
  const { client: c, res } = BasketClient.create(env, iss, mints, usdc, { label, authority: seed, maxConvertChunk: opts.maxConvertChunk });
  if (!res.ok) throw new Error("init " + res.error + "\n" + res.logs.join("\n"));
  const alice = kp(`${label}:alice`), bob = kp(`${label}:bob`);
  for (const u of [seed, alice, bob]) c.setupUser(u);
  const boot = opts.bootstrap ?? 10n ** 12n;
  for (const m of mints) iss.mintTo(m, c.userAta(seed.publicKey, m), boot);
  c.must(c.bootstrap(mints.map(() => boot)), "bootstrap");
  const ag = opts.aliceGross ?? 5n * 10n ** 11n;
  if (ag > 0n) {
    for (const m of mints) iss.mintTo(m, c.userAta(alice.publicKey, m), ag);
    c.must(c.depositInKind(alice, mints.map(() => ag)), "alice deposit");
  }
  for (const u of [alice, bob]) iss.mintTo(usdc, c.usdcAta(u.publicKey), 10n ** 12n, TOKEN);
  return { env, iss, c, seed, alice, bob, usdc };
}

export function balances(w: World, owner: PublicKey): bigint[] {
  return w.c.mints.map((m) => tokenAmount(w.env, w.c.userAta(owner, m)));
}

/** What a claim of `units` on leg i pays right now: floor(units × owned / (S + C)). */
export function claimValue(w: World, i: number, units: bigint): bigint {
  const l = w.c.legs()[i];
  return (units * w.c.owned(i)) / (w.c.supply() + l.claimUnits);
}

export const fee = (amount: bigint, bps = 100n) => (amount === 0n ? 0n : (amount * bps + 9_999n) / 10_000n);
