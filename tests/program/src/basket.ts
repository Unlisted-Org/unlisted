// Client for the real basket program, built from the published IDL (programs/basket/idl/basket.json).
import { AccountMeta, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import BN from "bn.js";
import { ATA, IDL, PROGRAM_ID, ROUTER_ID, SYSTEM, Svm, T22, TOKEN, TxResult, coder, kp, u64le } from "./env.ts";
import { Issuer, tokenAmount, mintSupply } from "./fixtures.ts";

export const INDEX_ONE = 10n ** 18n;

const ixDefs: Record<string, any> = Object.fromEntries((IDL as any).instructions.map((i: any) => [i.name, i]));

/** Build an instruction from the IDL: named accounts in IDL order (optional → program id), then remaining. */
export function ix(name: string, accounts: Record<string, PublicKey | null | undefined>, args: Record<string, any>,
  remaining: AccountMeta[] = []): TransactionInstruction {
  const def = ixDefs[name];
  if (!def) throw new Error("no ix " + name);
  const keys: AccountMeta[] = def.accounts.map((a: any) => {
    const pk = accounts[a.name];
    if (!pk) {
      if (a.optional) return { pubkey: PROGRAM_ID, isSigner: false, isWritable: false };
      if (a.address) return { pubkey: new PublicKey(a.address), isSigner: false, isWritable: false };
      throw new Error(`${name}: missing account ${a.name}`);
    }
    return { pubkey: pk, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  const data = coder.instruction.encode(name, args);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [...keys, ...remaining], data });
}

const bn = (x: bigint | number) => new BN(x.toString());
const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });

export interface LegState {
  mint: PublicKey; vault: PublicKey; accounted: bigint; claimUnits: bigint; pendingNorm: bigint; lossIndex: bigint;
  status: string; statusData: any;
}

export class BasketClient {
  env: Svm;
  issuer: Issuer;
  authority: Keypair;
  shareMint: PublicKey;
  basket: PublicKey;
  usdc: PublicKey;
  reserve: PublicKey;
  mints: PublicKey[];
  vaults: PublicKey[];
  poolAuth: PublicKey;
  nonces = new Map<string, number>();
  alt!: import("@solana/web3.js").AddressLookupTableAccount;

  constructor(env: Svm, issuer: Issuer, authority: Keypair, mints: PublicKey[], usdc: PublicKey, shareMint: Keypair) {
    this.env = env; this.issuer = issuer; this.authority = authority; this.mints = mints; this.usdc = usdc;
    this.shareMint = shareMint.publicKey;
    [this.basket] = PublicKey.findProgramAddressSync([Buffer.from("basket"), this.shareMint.toBuffer()], PROGRAM_ID);
    this.vaults = mints.map((m) => spl.getAssociatedTokenAddressSync(m, this.basket, true, T22));
    this.reserve = spl.getAssociatedTokenAddressSync(usdc, this.basket, true, TOKEN);
    [this.poolAuth] = PublicKey.findProgramAddressSync([Buffer.from("pool")], ROUTER_ID);
    env.fund(authority.publicKey, 100n * 1_000_000_000n);
    this.alt = env.setLookupTable(kp("alt:" + this.shareMint.toBase58()).publicKey, [
      PROGRAM_ID, ROUTER_ID, T22, TOKEN, ATA, SYSTEM, this.basket, this.shareMint, usdc, this.reserve, this.poolAuth,
      ...mints, ...this.vaults, ...mints.map((m) => this.pool(m)), this.pool(usdc, TOKEN),
    ]);
  }

  /** Every basket transaction goes through the basket's lookup table (v0), as the real client does. */
  send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    return this.env.send(ixs, signers, 1_400_000, [this.alt]);
  }

  /** Pre-create the share mint (authority = basket PDA) and initialise the basket. */
  static create(env: Svm, issuer: Issuer, mints: PublicKey[], usdc: PublicKey, opts: {
    label: string; authority?: Keypair; maxConvertChunk?: bigint; routers?: PublicKey[]; fundPools?: boolean;
  }): { client: BasketClient; res: TxResult } {
    const shareMint = kp("share:" + opts.label);
    const c = new BasketClient(env, issuer, opts.authority ?? kp("authority:" + opts.label), mints, usdc, shareMint);
    const lamports = env.svm.minimumBalanceForRentExemption(82n);
    const r1 = env.send([
      SystemProgram.createAccount({ fromPubkey: env.payer.publicKey, newAccountPubkey: c.shareMint, space: 82, lamports: Number(lamports), programId: TOKEN }),
      spl.createInitializeMint2Instruction(c.shareMint, 9, c.basket, null, TOKEN),
    ], [shareMint]);
    if (!r1.ok) throw new Error("share mint: " + r1.logs.join("\n"));
    const res = c.send([ix("initialize_basket", {
      payer: env.payer.publicKey, authority: c.authority.publicKey, basket: c.basket, share_mint: c.shareMint,
      usdc_mint: usdc, usdc_reserve: c.reserve,
    }, {
      n_legs: mints.length, mirror_of: mints.map((_, i) => kp("mirror" + i).publicKey),
      max_convert_chunk: bn(opts.maxConvertChunk ?? (1n << 64n) - 1n), routers: opts.routers ?? [ROUTER_ID],
    }, mints.flatMap((m, i) => [r(m), w(c.vaults[i])]))], [c.authority]);
    if (res.ok && opts.fundPools !== false) c.fundPools();
    return { client: c, res };
  }

  fundPools() {
    const ixs = [this.issuer.createAtaIx(this.poolAuth, this.usdc, TOKEN), ...this.mints.map((m) => this.issuer.createAtaIx(this.poolAuth, m))];
    for (let i = 0; i < ixs.length; i += 4) this.must(this.env.send(ixs.slice(i, i + 4)), "pool atas");
    this.issuer.mintTo(this.usdc, this.pool(this.usdc, TOKEN), 10n ** 18n, TOKEN);
    for (const m of this.mints) this.issuer.mintTo(m, this.pool(m), 10n ** 18n);
  }

  pool(mint: PublicKey, program = T22) { return this.issuer.ata(this.poolAuth, mint, program); }
  userAta(owner: PublicKey, mint: PublicKey, program = T22) { return this.issuer.ata(owner, mint, program); }
  shareAta(owner: PublicKey) { return this.userAta(owner, this.shareMint, TOKEN); }
  usdcAta(owner: PublicKey) { return this.userAta(owner, this.usdc, TOKEN); }

  /** Create a user's share, USDC and leg token accounts. */
  setupUser(user: Keypair) {
    this.env.fund(user.publicKey, 100n * 1_000_000_000n);
    const ixs = [this.issuer.createAtaIx(user.publicKey, this.shareMint, TOKEN), this.issuer.createAtaIx(user.publicKey, this.usdc, TOKEN),
      ...this.mints.map((m) => this.issuer.createAtaIx(user.publicKey, m))];
    for (let i = 0; i < ixs.length; i += 5) this.must(this.env.send(ixs.slice(i, i + 5)), "user atas");
  }

  must(res: TxResult, what: string): TxResult {
    if (!res.ok) throw new Error(`${what} failed: ${res.error}\n${res.logs.slice(-15).join("\n")}`);
    return res;
  }

  // ------------------------------------------------------------------ state
  state() {
    const a = this.env.account(this.basket)!;
    return coder.accounts.decode("Basket", a.data) as any;
  }
  legs(): LegState[] {
    return this.state().legs.slice(0, this.mints.length).map((l: any) => ({
      mint: l.mint, vault: l.vault, accounted: BigInt(l.accounted.toString()), claimUnits: BigInt(l.claim_units.toString()),
      pendingNorm: BigInt(l.pending_norm.toString()), lossIndex: BigInt(l.loss_index.toString()),
      status: Object.keys(l.status)[0], statusData: Object.values(l.status)[0],
    }));
  }
  balance(i: number) { return tokenAmount(this.env, this.vaults[i]); }
  supply() { return mintSupply(this.env, this.shareMint); }
  shares(owner: PublicKey) { return tokenAmount(this.env, this.shareAta(owner)); }
  activeLegs(): number[] { return this.legs().map((l, i) => [l, i] as const).filter(([l]) => l.status !== "Retired").map(([, i]) => i); }
  owned(i: number) {
    const l = this.legs()[i];
    return this.balance(i) - (l.pendingNorm * l.lossIndex) / INDEX_ONE;
  }
  nextNonce(owner: PublicKey) {
    const k = owner.toBase58();
    const n = this.nonces.get(k) ?? 0;
    this.nonces.set(k, n + 1);
    return n;
  }
  depositTicket(owner: PublicKey, nonce: number) {
    return PublicKey.findProgramAddressSync([Buffer.from("deposit"), this.basket.toBuffer(), owner.toBuffer(), u64le(nonce)], PROGRAM_ID)[0];
  }
  redeemTicket(owner: PublicKey, nonce: number) {
    return PublicKey.findProgramAddressSync([Buffer.from("redeem"), this.basket.toBuffer(), owner.toBuffer(), u64le(nonce)], PROGRAM_ID)[0];
  }
  redemption(ticket: PublicKey) {
    return coder.accounts.decode("RedemptionTicket", this.env.account(ticket)!.data) as any;
  }

  // ------------------------------------------------------------------ instructions
  legsKinded(owner: PublicKey | null) {
    return this.activeLegs().flatMap((i) => [r(this.mints[i]), w(this.vaults[i]), w(owner ? this.userAta(owner, this.mints[i]) : PROGRAM_ID)]);
  }
  legPairs(writable = false) {
    return this.activeLegs().flatMap((i) => [r(this.mints[i]), writable ? w(this.vaults[i]) : r(this.vaults[i])]);
  }

  bootstrap(gross: bigint[], initialShares: bigint, depositor = this.authority) {
    return this.send([ix("bootstrap", { depositor: depositor.publicKey, basket: this.basket, share_mint: this.shareMint,
      depositor_share_ata: this.shareAta(depositor.publicKey) }, { gross: gross.map(bn), initial_shares: bn(initialShares) },
    this.legsKinded(depositor.publicKey))], [depositor]);
  }

  depositInKind(user: Keypair, gross: bigint[], minShares = 0n) {
    return this.send([ix("deposit_in_kind", { depositor: user.publicKey, basket: this.basket, share_mint: this.shareMint,
      depositor_share_ata: this.shareAta(user.publicKey) }, { gross: gross.map(bn), min_shares: bn(minShares) },
    this.legsKinded(user.publicKey))], [user]);
  }

  redeemIx(user: PublicKey, nonce: number, shares: bigint, mode: "InKind" | { usdc: bigint }, withReserve: boolean) {
    const m = mode === "InKind" ? { InKind: {} } : { Usdc: { min_usdc_out: bn(mode.usdc) } };
    return ix("redeem", {
      owner: user, basket: this.basket, share_mint: this.shareMint, owner_share_ata: this.shareAta(user),
      ticket: this.redeemTicket(user, nonce), usdc_reserve: withReserve ? this.reserve : null,
      owner_usdc: withReserve ? this.usdcAta(user) : null,
    }, { nonce: bn(nonce), shares: bn(shares), mode: m }, this.legsKinded(mode === "InKind" ? user : null));
  }

  redeem(user: Keypair, shares: bigint, mode: "InKind" | { usdc: bigint } = "InKind", withReserve?: boolean) {
    const nonce = this.nextNonce(user.publicKey);
    const wr = withReserve ?? BigInt(this.state().accounted_usdc_reserve.toString()) > 0n;
    const res = this.send([this.redeemIx(user.publicKey, nonce, shares, mode, wr)], [user]);
    return { res, ticket: this.redeemTicket(user.publicKey, nonce), nonce };
  }

  settleClaim(cranker: Keypair, ticket: PublicKey, owner: PublicKey, leg: number, dest?: PublicKey) {
    return this.send([ix("settle_claim", {
      cranker: cranker.publicKey, basket: this.basket, ticket, leg_mint: this.mints[leg], leg_vault: this.vaults[leg],
      owner_token_account: dest ?? this.userAta(owner, this.mints[leg]), share_mint: this.shareMint,
    }, { leg })], [cranker]);
  }

  closeRedemption(owner: Keypair, ticket: PublicKey) {
    return this.send([ix("close_redemption", { owner: owner.publicKey, ticket }, {})], [owner]);
  }

  observe(legs: number[], cranker: Keypair = this.env.payer) {
    const mask = legs.reduce((a, i) => a | (1 << i), 0);
    const sorted = [...legs].sort((a, b) => a - b);
    return this.send([ix("observe", { cranker: cranker.publicKey, basket: this.basket }, { legs: mask },
      sorted.flatMap((i) => [r(this.mints[i]), r(this.vaults[i])]))], [cranker]);
  }

  harvest(leg: number) {
    return this.send([ix("harvest", { cranker: this.env.payer.publicKey, basket: this.basket, leg_mint: this.mints[leg], leg_vault: this.vaults[leg] }, { leg })]);
  }

  // ---- mock-router routes (tests only). Taker pays amount_in, the pool pays amount_out. ----
  route(taker: PublicKey, src: PublicKey, srcMint: PublicKey, dst: PublicKey, dstMint: PublicKey, amountIn: bigint, amountOut: bigint) {
    const srcProg = srcMint.equals(this.usdc) ? TOKEN : T22;
    const dstProg = dstMint.equals(this.usdc) ? TOKEN : T22;
    const accounts: AccountMeta[] = [
      r(taker), w(src), r(srcMint), w(this.pool(srcMint, srcProg)), w(dst), r(dstMint), w(this.pool(dstMint, dstProg)),
      r(this.poolAuth), r(srcProg), r(dstProg),
    ];
    const data = Buffer.concat([Buffer.from([0]), u64le(amountIn), u64le(amountOut)]);
    return { accounts, data };
  }

  openTicket(user: Keypair, usdcIn: bigint, expirySlots = 1500) {
    const nonce = this.nextNonce(user.publicKey);
    const ticket = this.depositTicket(user.publicKey, nonce);
    const escrow = this.issuer.ata(ticket, this.usdc, TOKEN);
    const res = this.send([ix("open_deposit_ticket", {
      owner: user.publicKey, basket: this.basket, ticket, escrow, owner_usdc: this.usdcAta(user.publicKey), usdc_mint: this.usdc,
    }, { nonce: bn(nonce), usdc_in: bn(usdcIn), expiry_slots: bn(expirySlots) }, this.legPairs())], [user]);
    return { res, ticket, escrow, nonce };
  }

  ticketSwapLegIx(user: PublicKey, ticket: PublicKey, leg: number, usdcAmount: bigint, minOut: bigint, legOut: bigint,
    routeOverride?: { accounts: AccountMeta[]; data: Buffer }, router = ROUTER_ID) {
    const escrow = this.issuer.ata(ticket, this.usdc, TOKEN);
    const rt = routeOverride ?? this.route(ticket, escrow, this.usdc, this.vaults[leg], this.mints[leg], usdcAmount, legOut);
    return ix("ticket_swap_leg", {
      owner: user, basket: this.basket, ticket, escrow, leg_mint: this.mints[leg], leg_vault: this.vaults[leg], router_program: router,
    }, { leg, usdc_amount: bn(usdcAmount), min_out: bn(minOut), route_data: rt.data }, rt.accounts);
  }

  ticketSwapLeg(user: Keypair, ticket: PublicKey, leg: number, usdcAmount: bigint, minOut: bigint, legOut: bigint) {
    return this.send([this.ticketSwapLegIx(user.publicKey, ticket, leg, usdcAmount, minOut, legOut)], [user]);
  }

  finalize(user: Keypair, ticket: PublicKey, minShares = 0n, extra: PublicKey[] = []) {
    const escrow = this.issuer.ata(ticket, this.usdc, TOKEN);
    return this.send([ix("finalize_deposit", {
      owner: user.publicKey, basket: this.basket, ticket, escrow, owner_usdc: this.usdcAta(user.publicKey),
      share_mint: this.shareMint, owner_share_ata: this.shareAta(user.publicKey),
    }, { min_shares: bn(minShares) }, [...this.legPairs(), ...extra.map(w)])], [user]);
  }

  unwindLeg(user: Keypair, ticket: PublicKey, leg: number, amountIn: bigint, usdcOut: bigint, minUsdc = 0n) {
    const escrow = this.issuer.ata(ticket, this.usdc, TOKEN);
    const rt = this.route(this.basket, this.vaults[leg], this.mints[leg], escrow, this.usdc, amountIn, usdcOut);
    return this.send([ix("unwind_leg", {
      owner: user.publicKey, basket: this.basket, ticket, escrow, leg_mint: this.mints[leg], leg_vault: this.vaults[leg], router_program: ROUTER_ID,
    }, { leg, min_usdc_out: bn(minUsdc), route_data: rt.data }, rt.accounts)], [user]);
  }

  abort(user: Keypair, ticket: PublicKey, extra: PublicKey[] = []) {
    const escrow = this.issuer.ata(ticket, this.usdc, TOKEN);
    return this.send([ix("abort_deposit", {
      owner: user.publicKey, basket: this.basket, ticket, escrow, owner_usdc: this.usdcAta(user.publicKey),
    }, {}, extra.map(w))], [user]);
  }

  settleLegUsdc(user: Keypair, ticket: PublicKey, leg: number, amountIn: bigint, usdcOut: bigint, minUsdc = 1n,
    routeOverride?: { accounts: AccountMeta[]; data: Buffer }) {
    const dst = this.usdcAta(user.publicKey);
    const rt = routeOverride ?? this.route(this.basket, this.vaults[leg], this.mints[leg], dst, this.usdc, amountIn, usdcOut);
    return this.send([ix("settle_leg_usdc", {
      owner: user.publicKey, basket: this.basket, ticket, leg_mint: this.mints[leg], leg_vault: this.vaults[leg], owner_usdc: dst,
      router_program: ROUTER_ID, share_mint: this.shareMint,
    }, { leg, min_usdc_out: bn(minUsdc), route_data: rt.data }, rt.accounts)], [user]);
  }

  flagListing(leg: number, convertAfter: bigint, deadline: bigint) {
    return this.send([ix("flag_listing", { authority: this.authority.publicKey, basket: this.basket },
      { leg, convert_after: bn(convertAfter), deadline: bn(deadline) })], [this.authority]);
  }

  convert(leg: number, amount: bigint, usdcOut: bigint, minUsdc = 1n, cranker: Keypair = this.env.payer) {
    const rt = this.route(this.basket, this.vaults[leg], this.mints[leg], this.reserve, this.usdc, amount, usdcOut);
    return this.send([ix("convert_listed_leg", {
      cranker: cranker.publicKey, basket: this.basket, leg_mint: this.mints[leg], leg_vault: this.vaults[leg], usdc_mint: this.usdc,
      usdc_reserve: this.reserve, router_program: ROUTER_ID,
    }, { leg, amount: bn(amount), min_usdc_out: bn(minUsdc), route_data: rt.data }, rt.accounts)], [cranker]);
  }

  reinvest(leg: number, usdcAmount: bigint, legOut: bigint, minOut = 1n, cranker: Keypair = this.env.payer) {
    const rt = this.route(this.basket, this.reserve, this.usdc, this.vaults[leg], this.mints[leg], usdcAmount, legOut);
    return this.send([ix("reinvest_reserve", {
      cranker: cranker.publicKey, basket: this.basket, usdc_mint: this.usdc, usdc_reserve: this.reserve,
      leg_mint: this.mints[leg], leg_vault: this.vaults[leg], router_program: ROUTER_ID,
    }, { leg, usdc_amount: bn(usdcAmount), min_out: bn(minOut), route_data: rt.data }, rt.accounts)], [cranker]);
  }

  authorityIx(name: string, args: Record<string, any>, signer = this.authority) {
    return this.send([ix(name, { authority: signer.publicKey, basket: this.basket }, args)], [signer]);
  }
}

export { SYSTEM, ATA };
