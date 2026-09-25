// POST /api/faucet { wallet }
// Test tokens for a visitor's wallet: 50 fixture USDC and about $20 of each of the seven fixture legs.
// The server signs only as the fixture mints' authority; the visitor's wallet is the fee payer and pays
// its own token-account rent, so the faucet never drains the issuer. One funding per wallet: refused
// if the wallet already holds 10 fixture USDC or more.
import {
  createAssociatedTokenAccountIdempotentInstruction, createMintToCheckedInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import { devnet, fixtures, issuer, json } from "@/lib/server/issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let wallet: PublicKey;
  try { wallet = new PublicKey((await req.json())?.wallet); } catch { return json({ error: "a wallet address is required" }, 400); }
  try {
    const kp = issuer();
    const conn = devnet();
    const usdcMint = new PublicKey(fixtures.usdc.mint), usdcProgram = new PublicKey(fixtures.usdc.tokenProgram);
    const t22 = new PublicKey(fixtures.token2022);
    const usdcAta = getAssociatedTokenAddressSync(usdcMint, wallet, false, usdcProgram);
    const bal = await conn.getTokenAccountBalance(usdcAta).then((r) => BigInt(r.value.amount)).catch(() => 0n);
    if (bal >= 10_000_000n) return json({ error: "this wallet already has test tokens", usdc: bal.toString() }, 409);

    const items = [
      { mint: usdcMint, program: usdcProgram, decimals: fixtures.usdc.decimals, raw: BigInt(fixtures.usdc.faucetRaw) },
      ...fixtures.legs.map((l) => ({ mint: new PublicKey(l.mint), program: t22, decimals: l.decimals, raw: BigInt(l.faucetRaw) })),
    ];
    // Two transactions keep each well under the size limit; the wallet approves both at once.
    // Confirmed on the dedicated RPC: about 13 s more life than finalized for the two faucet transactions.
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(process.env.HELIUS_API_KEY ? "confirmed" : "finalized");
    const txs = [items.slice(0, 4), items.slice(4)].map((group) => {
      const tx = new Transaction({ feePayer: wallet, recentBlockhash: blockhash });
      for (const it of group) {
        const ata = getAssociatedTokenAddressSync(it.mint, wallet, false, it.program);
        tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet, ata, wallet, it.mint, it.program));
        tx.add(createMintToCheckedInstruction(it.mint, ata, kp.publicKey, it.raw, it.decimals, [], it.program));
      }
      tx.partialSign(kp);
      return tx.serialize({ requireAllSignatures: false }).toString("base64");
    });
    return json({ transactions: txs, blockhash, lastValidBlockHeight });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e).slice(0, 300) }, e?.status ?? 502);
  }
}
