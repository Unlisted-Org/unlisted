// fixture_amm: Agent C's devnet router (fixtures/amm/src/lib.rs on branch `ops`, commit 5b5fbea).
// Interface as documented there:
//   swap (tag 1) { amount_in: u64, min_out: u64, side: u8 }   side 0 = buy leg with USDC, 1 = sell leg
//   accounts: 0 pool, 1 leg_mint, 2 usdc_mint, 3 leg_vault[w], 4 usdc_vault[w], 5 taker[s],
//             6 source[w], 7 destination[w], 8 leg_token_program, 9 usdc_token_program
//   pool PDA ["pool", leg_mint]; layout [0] tag 0xA1 [1] bump [2..4] fee_bps [4..36] admin
//   [36..68] leg_mint [68..100] usdc_mint [100..132] leg_vault [132..164] usdc_vault
// Constant product on the vaults' actual balances, input measured net of transfer fee.
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import { Router, RouterError, SwapRequest, SwapRoute } from "./types.js";
import { Writer } from "../codec.js";
import { feeAt, parseMint, parseTokenAccount, transferFee } from "../token2022.js";
import { ata } from "../pda.js";

export interface FixtureSwapBuilder {
  (req: SwapRequest): Promise<{ data: Uint8Array; accounts: AccountMeta[]; quotedOut: bigint; label?: string }>;
}

export const POOL_TAG = 0xa1;

export function poolPda(ammProgram: PublicKey, legMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("pool"), legMint.toBytes()], ammProgram)[0];
}

export interface PoolInfo { pool: PublicKey; feeBps: number; legMint: PublicKey; usdcMint: PublicKey; legVault: PublicKey; usdcVault: PublicKey }

export function parsePool(pool: PublicKey, d: Uint8Array): PoolInfo {
  if (d.length !== 164 || d[0] !== POOL_TAG) throw new RouterError("not a fixture_amm pool");
  const k = (a: number) => new PublicKey(d.slice(a, a + 32));
  return { pool, feeBps: d[2] | (d[3] << 8), legMint: k(36), usdcMint: k(68), legVault: k(100), usdcVault: k(132) };
}

/** Pure quote, mirroring the program: what the destination receives, net of every transfer fee. */
export function quoteFixtureSwap(p: {
  amountIn: bigint; inReserve: bigint; outReserve: bigint; lpFeeBps: number;
  inFee: { bps: number; maximumFee?: bigint } | null; outFee: { bps: number; maximumFee?: bigint } | null;
}): bigint {
  const received = p.amountIn - transferFee(p.amountIn, p.inFee);
  const eff = (received * BigInt(10_000 - p.lpFeeBps)) / 10_000n;
  const out = (p.outReserve * eff) / (p.inReserve + eff);
  return out - transferFee(out, p.outFee);
}

/** Swap builder reading the pool and vault balances live from `conn`. `usdcMint` decides the side. */
export function fixtureAmmSwapBuilder(conn: Connection, ammProgram: PublicKey, usdcMint: PublicKey): FixtureSwapBuilder {
  return async (req) => {
    const buy = req.inputMint.equals(usdcMint);
    const legMint = buy ? req.outputMint : req.inputMint;
    const pool = poolPda(ammProgram, legMint);
    const poolAcc = await conn.getAccountInfo(pool, "confirmed");
    if (!poolAcc) throw new RouterError(`no fixture_amm pool for ${legMint.toBase58()}`);
    const info = parsePool(pool, poolAcc.data);
    const [legMintAcc, usdcMintAcc, legVaultAcc, usdcVaultAcc] = await conn.getMultipleAccountsInfo(
      [info.legMint, info.usdcMint, info.legVault, info.usdcVault], "confirmed");
    if (!legMintAcc || !usdcMintAcc || !legVaultAcc || !usdcVaultAcc) throw new RouterError("fixture_amm pool accounts missing");
    const epoch = BigInt((await conn.getEpochInfo("confirmed")).epoch);
    const legFee = feeAt(parseMint(legMintAcc.data), epoch);
    const legRes = parseTokenAccount(legVaultAcc.data).amount;
    const usdcRes = parseTokenAccount(usdcVaultAcc.data).amount;
    const quotedOut = quoteFixtureSwap(buy
      ? { amountIn: req.amount, inReserve: usdcRes, outReserve: legRes, lpFeeBps: info.feeBps, inFee: null, outFee: legFee }
      : { amountIn: req.amount, inReserve: legRes, outReserve: usdcRes, lpFeeBps: info.feeBps, inFee: legFee, outFee: null });
    // The pool checks its own min_out; the basket checks the measured delta against the caller's.
    const minOut = (quotedOut * BigInt(10_000 - req.slippageBps)) / 10_000n;
    const source = ata(req.taker, req.inputMint, buy ? usdcMintAcc.owner : legMintAcc.owner);
    const data = new Writer().u8(1).u64(req.amount).u64(minOut).u8(buy ? 0 : 1).build();
    const accounts: AccountMeta[] = [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: info.legMint, isSigner: false, isWritable: false },
      { pubkey: info.usdcMint, isSigner: false, isWritable: false },
      { pubkey: info.legVault, isSigner: false, isWritable: true },
      { pubkey: info.usdcVault, isSigner: false, isWritable: true },
      { pubkey: req.taker, isSigner: true, isWritable: false },
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: req.destination, isSigner: false, isWritable: true },
      { pubkey: legMintAcc.owner, isSigner: false, isWritable: false },
      { pubkey: usdcMintAcc.owner, isSigner: false, isWritable: false },
    ];
    return { data, accounts, quotedOut, label: `fixture_amm ${info.feeBps} bps pool` };
  };
}

export class FixtureAmmRouter implements Router {
  readonly name = "fixture_amm";
  constructor(
    readonly programId: PublicKey,
    private readonly swapBuilder: FixtureSwapBuilder,
    private readonly lookupTables: { key: PublicKey; addresses: PublicKey[] }[] = [],
  ) {}
  static live(conn: Connection, programId: PublicKey, usdcMint: PublicKey): FixtureAmmRouter {
    return new FixtureAmmRouter(programId, fixtureAmmSwapBuilder(conn, programId, usdcMint));
  }
  async route(req: SwapRequest): Promise<SwapRoute> {
    const s = await this.swapBuilder(req);
    return {
      routerProgram: this.programId,
      routeData: s.data,
      routeAccounts: s.accounts,
      lookupTables: this.lookupTables,
      inAmount: req.amount,
      quotedOut: s.quotedOut,
      label: s.label ?? "fixture_amm pool",
      source: "fixture_amm (devnet; prices seeded from mainnet last trade)",
      priceImpactBps: null,
      preInstructions: [],
      intermediateAccounts: [],
    };
  }
}
