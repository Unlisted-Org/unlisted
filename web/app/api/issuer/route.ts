// POST /api/issuer { action: "pause" | "resume", symbol, passcode }
// The demo's issuer control: the devnet FIXTURE issuer pauses or resumes one fixture leg, exactly as
// PreStocks' multisig can pause a real one. Passcode-gated so only the presenter can trigger it; the
// app itself sees the pause the same way it sees a real one, by reading the mint.
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { devnet, fixtures, issuer, json, passcodeOk } from "@/lib/server/issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const T22 = new PublicKey(fixtures.token2022);
// Token-2022 PausableExtension (44), Pause (1) / Resume (2): the same encoding as scripts/lib/issuer.ts.
const ixPause = (mint: PublicKey, authority: PublicKey, pause: boolean) =>
  new TransactionInstruction({ programId: T22, data: Buffer.from([44, pause ? 1 : 2]), keys: [
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
  ] });

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON body required" }, 400); }
  if (!passcodeOk(body?.passcode)) return json({ error: "wrong or missing demo passcode" }, 403);
  const action = body?.action;
  if (action !== "pause" && action !== "resume") return json({ error: "action must be pause or resume" }, 400);
  const leg = fixtures.legs.find((l) => l.symbol === body?.symbol);
  if (!leg) return json({ error: `unknown company ${body?.symbol}` }, 400);
  try {
    const kp = issuer();
    const conn = devnet();
    const tx = new Transaction().add(ixPause(new PublicKey(leg.mint), kp.publicKey, action === "pause"));
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const signature = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    const st = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (st.value.err) return json({ error: `transaction failed: ${JSON.stringify(st.value.err)}`, signature }, 502);
    return json({ ok: true, action, symbol: leg.symbol, signature });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e).slice(0, 300) }, e?.status ?? 502);
  }
}
