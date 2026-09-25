// Measures how deposit-ticket transactions pack with LIVE mainnet Jupiter routes (read-only:
// /build calls and local compilation; nothing is signed or sent).
//
// The basket program id is not known yet (Agent A), so a throwaway program id stands in; that
// changes PDAs but not account counts or sizes. Usage: npx tsx scripts/measure-packing.ts [usdcPerLeg]
import { Keypair, PublicKey } from "@solana/web3.js";
import { CONSTITUENTS, MAINNET_USDC, TOKEN_PROGRAM_ID } from "../src/constants.js";
import { JupiterRouter } from "../src/routers/jupiter.js";
import { depositTicketPda, ticketEscrow, basketPda, legVault, ata } from "../src/pda.js";
import * as ix from "../src/instructions.js";
import { packTicket } from "../src/flows.js";
import { measure, basketLookupAddresses } from "../src/tx.js";
import { JUPITER_V6_PROGRAM_ID } from "../src/constants.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

const usdcPerLeg = BigInt(Math.round(Number(process.argv[2] ?? "10") * 1e6));
const programId = Keypair.generate().publicKey;
const shareMint = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const [basket] = basketPda(programId, shareMint);
const nonce = 1n;
const [ticket] = depositTicketPda(programId, basket, owner, nonce);
const escrow = ticketEscrow(ticket, MAINNET_USDC);
const ownerUsdc = ata(owner, MAINNET_USDC, TOKEN_PROGRAM_ID);
const blockhash = "11111111111111111111111111111111";

async function main() {
  const maxAccounts = Number(process.argv[3] ?? "30");
  const router = new JupiterRouter({ maxAccounts });
  const routes = [];
  for (const c of CONSTITUENTS) {
    const mint = new PublicKey(c.mainnetMint);
    const vault = legVault(basket, mint);
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await router.route({ inputMint: MAINNET_USDC, outputMint: mint, amount: usdcPerLeg, taker: ticket, destination: vault, slippageBps: 150, payer: owner });
        routes.push({ c, mint, vault, r });
        break;
      } catch (e) {
        if (attempt > 6) throw e;
        await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
      }
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
  const open = ix.openDepositTicket({ programId, owner, basket, ticket, escrow, ownerUsdc, usdcMint: MAINNET_USDC, nonce, usdcIn: usdcPerLeg * 7n, expirySlots: 1500n, legs: routes.map((x) => ({ mint: x.mint, vault: x.vault })) }).ix;
  const swaps = routes.map((x, i) => [...x.r.preInstructions, ix.ticketSwapLeg({ programId, owner, basket, ticket, escrow, legMint: x.mint, legVault: x.vault,
    routerProgram: x.r.routerProgram, routeAccounts: x.r.routeAccounts, leg: i, usdcAmount: usdcPerLeg, minOut: x.r.quotedOut, routeData: x.r.routeData }).ix]);
  const shareAta = ata(owner, shareMint, TOKEN_PROGRAM_ID);
  const fin = [createAssociatedTokenAccountIdempotentInstruction(owner, shareAta, owner, shareMint, TOKEN_PROGRAM_ID),
    ix.finalizeDeposit({ programId, owner, basket, ticket, escrow, ownerUsdc, shareMint, ownerShareAta: shareAta,
      legs: routes.map((x) => ({ mint: x.mint, vault: x.vault })), minShares: 1n, intermediates: routes.flatMap((x) => x.r.intermediateAccounts) }).ix];
  const routeLuts = routes.flatMap((x) => x.r.lookupTables);
  const basketLut = { key: Keypair.generate().publicKey, addresses: basketLookupAddresses({ programId, basket, shareMint, usdcMint: MAINNET_USDC,
    legs: routes.map((x) => ({ mint: x.mint, vault: x.vault })), routers: [JUPITER_V6_PROGRAM_ID] }) };
  const perLeg = routes.map((x, i) => ({
    leg: x.c.symbol, route: x.r.label, routeAccounts: x.r.routeAccounts.length, luts: x.r.lookupTables.length,
    intermediateAccounts: x.r.intermediateAccounts.map((a) => a.toBase58()), quotedOut: x.r.quotedOut.toString(),
    alone: measure(owner, blockhash, swaps[i], x.r.lookupTables),
  }));
  const result: any = { measuredAt: new Date().toISOString(), usdcPerLeg: usdcPerLeg.toString(), maxAccounts, perLeg, packings: {} };
  for (const [name, luts] of [["routeLutsOnly", routeLuts], ["withBasketLut", [basketLut, ...routeLuts]]] as const) for (const k of [4, 3]) {
    try {
      result.packings[`${name}.max${k}`] = packTicket(owner, blockhash, open, swaps, fin, [...luts], k).map((p) => ({ legs: p.legs, bytes: p.packed.bytes, accounts: p.packed.accounts, open: p.hasOpen, finalize: p.hasFinalize }));
    } catch (e) {
      result.packings[`${name}.max${k}`] = String(e);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
