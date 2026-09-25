// Compares the SDK (built from spec 02) with Agent A's generated Anchor IDL.
// Usage: npx tsx scripts/idl-check.ts [path/to/basket.json]
//   default: `git show program:programs/basket/idl/basket.json` (read-only)
// Prints every difference. Differences are REPORTED (docs/reports), never silently adapted.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import * as ix from "../src/instructions.js";
import { discriminator } from "../src/codec.js";
import { ACCOUNT_DISCRIMINATORS } from "../src/accounts.js";
import { EVENT_NAMES } from "../src/events.js";
import { ERRORS } from "../src/constants.js";

const SPEC_ARGS: Record<string, [string, string][]> = {
  initialize_basket: [["n_legs", "u8"], ["mirror_of", "vec<pubkey>"], ["max_convert_chunk", "u64"], ["routers", "vec<pubkey>"]],
  propose_router: [["router", "pubkey"]],
  remove_router: [["router", "pubkey"]],
  activate_router: [["router", "pubkey"]],
  set_deposits_enabled: [["enabled", "bool"]],
  flag_listing: [["leg", "u8"], ["convert_after", "i64"], ["deadline", "i64"]],
  cancel_listing: [["leg", "u8"]],
  bootstrap: [["gross", "vec<u64>"]],
  deposit_in_kind: [["gross", "vec<u64>"], ["min_shares", "u64"]],
  open_deposit_ticket: [["nonce", "u64"], ["usdc_in", "u64"], ["expiry_slots", "u64"]],
  ticket_swap_leg: [["leg", "u8"], ["usdc_amount", "u64"], ["min_out", "u64"], ["route_data", "bytes"]],
  finalize_deposit: [["min_shares", "u64"]],
  unwind_leg: [["leg", "u8"], ["min_usdc_out", "u64"], ["route_data", "bytes"]],
  abort_deposit: [],
  redeem: [["nonce", "u64"], ["shares", "u64"], ["mode", "RedeemMode"]],
  settle_claim: [["leg", "u8"]],
  settle_leg_usdc: [["leg", "u8"], ["min_usdc_out", "u64"], ["route_data", "bytes"]],
  close_redemption: [],
  observe: [["legs", "u8"]],
  harvest: [["leg", "u8"]],
  convert_listed_leg: [["leg", "u8"], ["amount", "u64"], ["min_usdc_out", "u64"], ["route_data", "bytes"]],
  reinvest_reserve: [["leg", "u8"], ["usdc_amount", "u64"], ["min_out", "u64"], ["route_data", "bytes"]],
};

function typeStr(t: any): string {
  if (typeof t === "string") return t === "publicKey" ? "pubkey" : t;
  if (t.vec) return `vec<${typeStr(t.vec)}>`;
  if (t.array) return `[${typeStr(t.array[0])};${t.array[1]}]`;
  if (t.option) return `option<${typeStr(t.option)}>`;
  if (t.defined) return typeof t.defined === "string" ? t.defined : t.defined.name;
  return JSON.stringify(t);
}
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");

// Named-account lists as the SDK builds them (dummy keys).
const k = () => Keypair.generate().publicKey;
const legs = Array.from({ length: 7 }, () => ({ mint: k(), vault: k(), userTokenAccount: k() }));
const P = { programId: k() };
const built: Record<string, string[]> = {
  initialize_basket: ix.initializeBasket({ ...P, payer: k(), authority: k(), basket: k(), shareMint: k(), usdcMint: k(), usdcReserve: k(), legs, mirrorOf: legs.map(k), maxConvertChunk: 1n, routers: [] }).named.map((n) => n.name),
  propose_router: ix.proposeRouter({ ...P, authority: k(), basket: k(), router: k() }).named.map((n) => n.name),
  remove_router: ix.removeRouter({ ...P, authority: k(), basket: k(), router: k() }).named.map((n) => n.name),
  activate_router: ix.activateRouter({ ...P, authority: k(), basket: k(), router: k() }).named.map((n) => n.name),
  set_deposits_enabled: ix.setDepositsEnabled({ ...P, authority: k(), basket: k(), enabled: true }).named.map((n) => n.name),
  flag_listing: ix.flagListing({ ...P, authority: k(), basket: k(), leg: 0, convertAfter: 0n, deadline: 0n }).named.map((n) => n.name),
  cancel_listing: ix.cancelListing({ ...P, authority: k(), basket: k(), leg: 0 }).named.map((n) => n.name),
  bootstrap: ix.bootstrap({ ...P, depositor: k(), basket: k(), shareMint: k(), depositorShareAta: k(), legs, gross: [1n] }).named.map((n) => n.name),
  deposit_in_kind: ix.depositInKind({ ...P, depositor: k(), basket: k(), shareMint: k(), depositorShareAta: k(), legs, gross: [1n], minShares: 1n }).named.map((n) => n.name),
  open_deposit_ticket: ix.openDepositTicket({ ...P, owner: k(), basket: k(), ticket: k(), escrow: k(), ownerUsdc: k(), usdcMint: k(), nonce: 1n, usdcIn: 1n, expirySlots: 1n, legs }).named.map((n) => n.name),
  ticket_swap_leg: ix.ticketSwapLeg({ ...P, owner: k(), basket: k(), ticket: k(), escrow: k(), legMint: k(), legVault: k(), routerProgram: k(), routeAccounts: [], leg: 0, usdcAmount: 1n, minOut: 1n, routeData: new Uint8Array() }).named.map((n) => n.name),
  finalize_deposit: ix.finalizeDeposit({ ...P, owner: k(), basket: k(), ticket: k(), escrow: k(), ownerUsdc: k(), shareMint: k(), ownerShareAta: k(), legs, minShares: 1n }).named.map((n) => n.name),
  unwind_leg: ix.unwindLeg({ ...P, owner: k(), basket: k(), ticket: k(), escrow: k(), legMint: k(), legVault: k(), routerProgram: k(), routeAccounts: [], leg: 0, minUsdcOut: 1n, routeData: new Uint8Array() }).named.map((n) => n.name),
  abort_deposit: ix.abortDeposit({ ...P, owner: k(), basket: k(), ticket: k(), escrow: k(), ownerUsdc: k() }).named.map((n) => n.name),
  redeem: ix.redeem({ ...P, owner: k(), basket: k(), shareMint: k(), ownerShareAta: k(), ticket: k(), usdcReserve: null, legs, nonce: 1n, shares: 1n, mode: { kind: "InKind" } }).named.map((n) => n.name),
  settle_claim: ix.settleClaim({ ...P, cranker: k(), basket: k(), ticket: k(), legMint: k(), legVault: k(), ownerTokenAccount: k(), leg: 0, shareMint: k() }).named.map((n) => n.name),
  settle_leg_usdc: ix.settleLegUsdc({ ...P, owner: k(), basket: k(), ticket: k(), legMint: k(), legVault: k(), ownerUsdc: k(), routerProgram: k(), routeAccounts: [], leg: 0, minUsdcOut: 1n, routeData: new Uint8Array(), shareMint: k() }).named.map((n) => n.name),
  close_redemption: ix.closeRedemption({ ...P, owner: k(), ticket: k() }).named.map((n) => n.name),
  observe: ix.observeIx({ ...P, cranker: k(), basket: k(), legs, mask: 1 }).named.map((n) => n.name),
  harvest: ix.harvest({ ...P, cranker: k(), basket: k(), legMint: k(), legVault: k(), leg: 0 }).named.map((n) => n.name),
  convert_listed_leg: ix.convertListedLeg({ ...P, cranker: k(), basket: k(), legMint: k(), legVault: k(), usdcMint: k(), usdcReserve: k(), routerProgram: k(), routeAccounts: [], leg: 0, amount: 1n, minUsdcOut: 1n, routeData: new Uint8Array() }).named.map((n) => n.name),
  reinvest_reserve: ix.reinvestReserve({ ...P, cranker: k(), basket: k(), usdcMint: k(), usdcReserve: k(), legMint: k(), legVault: k(), routerProgram: k(), routeAccounts: [], leg: 0, usdcAmount: 1n, minOut: 1n, routeData: new Uint8Array() }).named.map((n) => n.name),
};

function loadIdl(): any {
  const p = process.argv[2];
  if (p) return JSON.parse(readFileSync(p, "utf8"));
  return JSON.parse(execSync(`git -C /Users/jagadeesh/1nonly/grants/stocklana show ${process.env.IDL_REF ?? "program"}:programs/basket/idl/basket.json`, { encoding: "utf8" }));
}

const idl = loadIdl();
const diffs: string[] = [];
const hex = (b: Uint8Array | number[]) => Buffer.from(b).toString("hex");
const idlIx = new Map<string, any>((idl.instructions ?? []).map((i: any) => [snake(i.name), i]));
for (const name of [...ix.SPEC_INSTRUCTIONS, "remove_router"]) {
  const i = idlIx.get(name);
  if (!i) { diffs.push(`instruction ${name}: missing from IDL`); continue; }
  if (i.discriminator && hex(i.discriminator) !== hex(discriminator("global", name))) diffs.push(`instruction ${name}: discriminator ${hex(i.discriminator)} != sha256(global:${name})`);
  const idlAccts = (i.accounts ?? []).map((a: any) => snake(a.name));
  if (JSON.stringify(idlAccts) !== JSON.stringify(built[name])) diffs.push(`instruction ${name}: accounts\n    IDL: ${idlAccts.join(", ")}\n    SDK: ${built[name].join(", ")}`);
  const idlArgs = (i.args ?? []).map((a: any) => [snake(a.name), typeStr(a.type)]);
  if (JSON.stringify(idlArgs) !== JSON.stringify(SPEC_ARGS[name])) diffs.push(`instruction ${name}: args\n    IDL: ${JSON.stringify(idlArgs)}\n    SDK: ${JSON.stringify(SPEC_ARGS[name])}`);
}
for (const extra of idlIx.keys()) if (![...ix.SPEC_INSTRUCTIONS, "remove_router"].includes(extra as any)) diffs.push(`instruction ${extra}: in IDL, not in spec 02`);
for (const [n, d] of Object.entries(ACCOUNT_DISCRIMINATORS)) {
  const a = (idl.accounts ?? []).find((x: any) => x.name === n);
  if (!a) diffs.push(`account ${n}: missing from IDL`);
  else if (a.discriminator && hex(a.discriminator) !== hex(d)) diffs.push(`account ${n}: discriminator differs`);
}
for (const n of EVENT_NAMES) if (!(idl.events ?? []).some((e: any) => e.name === n)) diffs.push(`event ${n}: missing from IDL`);
for (const [code, name] of Object.entries(ERRORS)) {
  const e = (idl.errors ?? []).find((x: any) => x.code === Number(code));
  if (!e || e.name !== name) diffs.push(`error ${code} ${name}: IDL has ${e ? e.name : "nothing"}`);
}
// Type layouts: print the IDL's field lists for Basket, Leg, tickets and enums for manual comparison with accounts.ts.
const types = new Map<string, any>((idl.types ?? []).map((t: any) => [t.name, t]));
for (const t of ["Basket", "Leg", "LegStatus", "DepositTicket", "RedemptionTicket", "TicketLeg", "ClaimReason", "RedeemMode"]) {
  const d = types.get(t);
  if (!d) { diffs.push(`type ${t}: missing from IDL`); continue; }
  const body = d.type.kind === "struct" ? d.type.fields.map((f: any) => `${snake(f.name)}: ${typeStr(f.type)}`) : d.type.variants.map((v: any) => v.name + (v.fields ? `{${v.fields.map((f: any) => (f.name ? `${f.name}: ${typeStr(f.type)}` : typeStr(f))).join(", ")}}` : ""));
  console.log(`type ${t}: ${body.join("; ")}`);
}
console.log(diffs.length ? `\n${diffs.length} difference(s) from spec 02 / SDK:\n- ${diffs.join("\n- ")}` : "\nNo differences in instructions, accounts, events or errors.");
process.exitCode = diffs.length ? 1 : 0;
