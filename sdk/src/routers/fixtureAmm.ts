// fixture_amm: Agent C's devnet router (fixtures/amm/ on branch `ops`). Its instruction layout is
// not published yet, so the swap builder is injected; once C publishes the program and
// fixtures/registry.json, `swapBuilder` is filled from that interface. Nothing here guesses it.
import { AccountMeta, PublicKey } from "@solana/web3.js";
import { Router, RouterError, SwapRequest, SwapRoute } from "./types.js";

export interface FixtureSwapBuilder {
  (req: SwapRequest): Promise<{ data: Uint8Array; accounts: AccountMeta[]; quotedOut: bigint; label?: string }>;
}

export class FixtureAmmRouter implements Router {
  readonly name = "fixture_amm";
  constructor(
    readonly programId: PublicKey,
    private readonly swapBuilder: FixtureSwapBuilder | null,
    private readonly lookupTables: { key: PublicKey; addresses: PublicKey[] }[] = [],
  ) {}
  async route(req: SwapRequest): Promise<SwapRoute> {
    if (!this.swapBuilder) throw new RouterError("fixture_amm swap interface not published yet (Agent C, branch ops)");
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
      leftOpenAccounts: [],
    };
  }
}
