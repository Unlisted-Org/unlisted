// App state: chain reads through the SDK, refreshed on a timer and after every transaction.
import { useCallback, useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { BasketClient, BasketView, RedemptionTicket, DepositTicket, BasketEvent, TOKEN_2022_PROGRAM_ID, ata } from "@stocklana/sdk";

export interface Position {
  owner: PublicKey;
  shares: bigint;
  legBalances: bigint[]; // the wallet's own token balance per leg (raw)
  legAtaExists: boolean[];
  usdc: bigint;
  redemptions: { address: PublicKey; ticket: RedemptionTicket }[];
  deposits: { address: PublicKey; ticket: DepositTicket }[];
  slot: number;
}

export interface EventRow { signature: string; slot: number; blockTime: number | null; events: BasketEvent[] }

export function useBasket(client: BasketClient | null, refreshMs = 8000) {
  const [view, setView] = useState<BasketView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!client) return;
    let live = true;
    client.fetchBasket().then((v) => { if (live) { setView(v); setError(null); } }).catch((e) => live && setError(String(e?.message ?? e)));
    const id = setTimeout(() => setTick((t) => t + 1), refreshMs);
    return () => { live = false; clearTimeout(id); };
  }, [client, tick, refreshMs]);
  return { view, error, refresh };
}

export async function fetchPosition(conn: Connection, client: BasketClient, view: BasketView, owner: PublicKey): Promise<Position> {
  const legAtas = view.legs.map((l) => ata(owner, l.mint, TOKEN_2022_PROGRAM_ID));
  const usdcAta = ata(owner, view.basket.usdcMint, view.usdcMintProgram);
  const shareAta = ata(owner, view.basket.shareMint);
  const res = await conn.getMultipleAccountsInfoAndContext([shareAta, usdcAta, ...legAtas], "confirmed");
  const amt = (d: { data: Buffer } | null) => (d ? new DataView(d.data.buffer, d.data.byteOffset + 64, 8).getBigUint64(0, true) : 0n);
  const [redemptions, deposits] = await Promise.all([client.redemptionTickets(owner), client.depositTickets(owner)]);
  return {
    owner,
    shares: amt(res.value[0] as any),
    usdc: amt(res.value[1] as any),
    legBalances: legAtas.map((_, i) => amt(res.value[2 + i] as any)),
    legAtaExists: legAtas.map((_, i) => !!res.value[2 + i]),
    redemptions: redemptions.sort((a, b) => Number(b.ticket.nonce - a.ticket.nonce)),
    deposits,
    slot: res.context.slot,
  };
}

export function usePosition(conn: Connection | null, client: BasketClient | null, view: BasketView | null, owner: PublicKey | null) {
  const [pos, setPos] = useState<Position | null>(null);
  const viewSlot = view?.slot;
  const ref = useRef(0);
  useEffect(() => {
    if (!conn || !client || !view || !owner) { setPos(null); return; }
    const n = ++ref.current;
    fetchPosition(conn, client, view, owner).then((p) => n === ref.current && setPos(p)).catch(() => {});
  }, [conn, client, viewSlot, owner?.toBase58()]);
  return pos;
}

export function useEvents(client: BasketClient | null, viewSlot: number | undefined) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const last = useRef(0);
  useEffect(() => {
    if (!client || !viewSlot) return;
    // Re-read at most every 20 s: getTransaction per signature is the expensive part.
    if (Date.now() - last.current < 20_000 && rows.length) return;
    last.current = Date.now();
    client.recentEvents(40).then(setRows).catch(() => {});
  }, [client, viewSlot]);
  return { rows, reload: () => { last.current = 0; client?.recentEvents(40).then(setRows).catch(() => {}); } };
}
