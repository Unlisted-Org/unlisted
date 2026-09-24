// Jupiter swap v2 /build: the mainnet (and cloned-mainnet fork) router.
// maxAccounts≈30 and excludeDexes=Manifest (spec 02; spec 03 sell_now; Phase 0 Q3):
// Manifest's adapter quotes PreStocks output gross of the transfer fee (Bonasa-Tech/manifest#735).
import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { JUPITER_EXCLUDE_DEXES, JUPITER_MAX_ACCOUNTS, JUPITER_V6_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "../constants.js";
import { Router, RouterError, SwapRequest, SwapRoute } from "./types.js";

interface JupIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }

function b64(s: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(s, "base64"));
}

export class JupiterRouter implements Router {
  readonly name = "jupiter-v2-build";
  constructor(
    private readonly opts: { baseUrl?: string; maxAccounts?: number; excludeDexes?: string; apiKey?: string; fetchFn?: typeof fetch } = {},
  ) {}

  buildUrl(req: SwapRequest): string {
    const u = new URL(`${this.opts.baseUrl ?? "https://api.jup.ag"}/swap/v2/build`);
    u.searchParams.set("inputMint", req.inputMint.toBase58());
    u.searchParams.set("outputMint", req.outputMint.toBase58());
    u.searchParams.set("amount", req.amount.toString());
    u.searchParams.set("taker", req.taker.toBase58());
    u.searchParams.set("destinationTokenAccount", req.destination.toBase58());
    u.searchParams.set("slippageBps", String(req.slippageBps));
    u.searchParams.set("maxAccounts", String(this.opts.maxAccounts ?? JUPITER_MAX_ACCOUNTS));
    u.searchParams.set("excludeDexes", this.opts.excludeDexes ?? JUPITER_EXCLUDE_DEXES);
    return u.toString();
  }

  async route(req: SwapRequest): Promise<SwapRoute> {
    const f = this.opts.fetchFn ?? fetch;
    const res = await f(this.buildUrl(req), { headers: this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {} });
    if (!res.ok) throw new RouterError(`jupiter /build HTTP ${res.status}: ${await res.text()}`);
    return JupiterRouter.parse(await res.json(), req);
  }

  /** Turn a /build response into a CPI route. Exposed for tests with recorded responses. */
  static parse(j: any, req: SwapRequest): SwapRoute {
    if (!j.swapInstruction) throw new RouterError(`jupiter: no swapInstruction (${j.error ?? "unknown"})`);
    // Setup instructions are ATA creations paid by the taker. The taker is a PDA and can't sign at
    // top level, so each needed one is re-issued with the user as payer. The output ATA isn't
    // needed (destinationTokenAccount is the vault) and is skipped. Anything else is refused.
    const si = j.swapInstruction as JupIx;
    const inSwap = new Set(si.accounts.map((a) => a.pubkey));
    const preInstructions: TransactionInstruction[] = [];
    const leftOpenAccounts: PublicKey[] = [];
    for (const s of (j.setupInstructions ?? []) as JupIx[]) {
      if (s.programId !== ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) throw new RouterError(`jupiter: unsupported setup instruction ${s.programId}`);
      const [, ataKey, owner, mint, system, tokenProgram] = s.accounts;
      // The taker's source account (the ticket escrow, or the basket vault on a sale) already
      // exists, and its output account is replaced by the destination override: skip both.
      if (mint.pubkey === req.inputMint.toBase58() || mint.pubkey === req.outputMint.toBase58()) continue;
      if (!inSwap.has(ataKey.pubkey)) continue;
      if (!req.payer) throw new RouterError("jupiter: route needs an intermediate token account; pass payer");
      preInstructions.push(new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
          { pubkey: req.payer, isSigner: true, isWritable: true },
          { pubkey: new PublicKey(ataKey.pubkey), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(owner.pubkey), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(mint.pubkey), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(system.pubkey), isSigner: false, isWritable: false },
          { pubkey: new PublicKey(tokenProgram.pubkey), isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]), // CreateIdempotent
      }));
      leftOpenAccounts.push(new PublicKey(ataKey.pubkey));
    }
    // A cleanup that closes an intermediate wSOL account needs the PDA's signature: dropped, and
    // the account is reported as left open. Any other extra instruction is refused.
    if (j.cleanupInstruction && j.cleanupInstruction.programId !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
      throw new RouterError(`jupiter: unsupported cleanup instruction ${j.cleanupInstruction.programId}`);
    }
    if ((j.otherInstructions ?? []).length) throw new RouterError("jupiter: route needs other instructions; not CPI-able");
    if (si.programId !== JUPITER_V6_PROGRAM_ID.toBase58()) throw new RouterError(`jupiter: unexpected program ${si.programId}`);
    const routeAccounts: AccountMeta[] = si.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable }));
    const signers = routeAccounts.filter((a) => a.isSigner).map((a) => a.pubkey.toBase58());
    if (signers.some((s) => s !== req.taker.toBase58())) throw new RouterError(`jupiter: route needs a signer other than the taker: ${signers}`);
    if (!routeAccounts.some((a) => a.pubkey.equals(req.destination))) throw new RouterError("jupiter: destination account not in route");
    const lookupTables = Object.entries((j.addressesByLookupTableAddress ?? {}) as Record<string, string[]>).map(([k, v]) => ({
      key: new PublicKey(k), addresses: v.map((x) => new PublicKey(x)),
    }));
    const labels = ((j.routePlan ?? []) as any[]).map((r) => r.swapInfo?.label).filter(Boolean);
    return {
      routerProgram: JUPITER_V6_PROGRAM_ID,
      routeData: b64(si.data),
      routeAccounts,
      lookupTables,
      inAmount: BigInt(j.inAmount),
      quotedOut: BigInt(j.outAmount),
      label: [...new Set(labels)].join(" → ") || "jupiter",
      source: "jupiter swap/v2 build",
      priceImpactBps: j.priceImpactPct != null ? Math.round(Number(j.priceImpactPct) * 10_000) : null,
      preInstructions,
      leftOpenAccounts,
    };
  }
}
