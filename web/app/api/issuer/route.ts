// POST /api/issuer { action: "pause" | "resume", symbol, passcode }
// The demo's issuer control: the devnet FIXTURE issuer pauses or resumes one fixture leg, exactly as
// PreStocks' multisig can pause a real one. Passcode-gated so only the presenter can trigger it; the
// app itself sees the pause the same way it sees a real one, by reading the mint.
//
// Filmed live, so it must not hang: it is idempotent (a mint already in the requested state returns at
// once), it confirms over HTTP rather than a websocket, and if a transaction hasn't landed it re-signs
// with a fresh blockhash (the server holds the key) until a deadline, then says so plainly.
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { devnet, fixtures, issuer, json, passcodeOk } from "@/lib/server/issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const T22 = new PublicKey(fixtures.token2022);
const DEADLINE_MS = 50_000;
const RESIGN_AFTER_MS = 20_000;
// Token-2022 PausableExtension (44), Pause (1) / Resume (2): the same encoding as scripts/lib/issuer.ts.
const ixPause = (mint: PublicKey, authority: PublicKey, pause: boolean) =>
  new TransactionInstruction({ programId: T22, data: Buffer.from([44, pause ? 1 : 2]), keys: [
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
  ] });

/** The mint's paused flag, read from the pausable extension (jsonParsed). */
async function paused(conn: Connection, mint: PublicKey): Promise<boolean> {
  const info = await conn.getParsedAccountInfo(mint, "confirmed");
  const ext = ((info.value?.data as any)?.parsed?.info?.extensions ?? []).find((e: any) => e.extension === "pausableConfig");
  return !!ext?.state?.paused;
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON body required" }, 400); }
  if (!passcodeOk(body?.passcode)) return json({ error: "wrong or missing demo passcode" }, 403);
  const action = body?.action;
  if (action !== "pause" && action !== "resume") return json({ error: "action must be pause or resume" }, 400);
  const leg = fixtures.legs.find((l) => l.symbol === body?.symbol);
  if (!leg) return json({ error: `unknown company ${body?.symbol}` }, 400);
  const want = action === "pause";
  const started = Date.now();
  try {
    const kp = issuer();
    const conn = devnet();
    const mint = new PublicKey(leg.mint);
    if ((await paused(conn, mint)) === want) return json({ ok: true, action, symbol: leg.symbol, already: true });
    const sent: string[] = [];
    while (Date.now() - started < DEADLINE_MS) {
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(ixPause(mint, kp.publicKey, want));
      tx.sign(kp);
      const raw = tx.serialize();
      const signature = await conn.sendRawTransaction(raw, { maxRetries: 0 });
      sent.push(signature);
      const t0 = Date.now();
      while (Date.now() - t0 < RESIGN_AFTER_MS && Date.now() - started < DEADLINE_MS) {
        await new Promise((r) => setTimeout(r, 700));
        const st = (await conn.getSignatureStatuses([signature])).value[0];
        if (st?.err) return json({ error: `transaction failed: ${JSON.stringify(st.err)}`, signature }, 502);
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return json({ ok: true, action, symbol: leg.symbol, signature, attempts: sent.length });
        await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
      }
      // Not landed yet. It may still land from an earlier attempt; the state check makes a re-sign safe.
      if ((await paused(conn, mint)) === want) return json({ ok: true, action, symbol: leg.symbol, attempts: sent.length, landedUnseen: sent });
    }
    return json({ error: `the network didn't confirm the ${action} within ${DEADLINE_MS / 1000} s; nothing changed`, sent }, 504);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e).slice(0, 300) }, e?.status ?? 502);
  }
}
