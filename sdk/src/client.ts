// Chain reads: basket state, per-leg availability and fees, positions, tickets, claims, events.
// Every figure here comes from an account read at a stated slot; nothing is cached across calls.
import { Connection, PublicKey } from "@solana/web3.js";
import {
  Basket, DepositTicket, RedemptionTicket, ACCOUNT_DISCRIMINATORS, TICKET_OWNER_OFFSET, TICKET_BASKET_OFFSET,
  decodeBasket, decodeDepositTicket, decodeRedemptionTicket,
} from "./accounts.js";
import { CONSTITUENTS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";
import { LegState } from "./math.js";
import { basketPda, ata } from "./pda.js";
import {
  MintInfo, TokenAccountInfo, TransferFee, Unavailable, effectiveMultiplier, feeAt, parseMint, parseTokenAccount, pendingFee, unavailableReasons,
} from "./token2022.js";
import { BasketEvent, parseEventsFromLogs } from "./events.js";
import bs58 from "bs58";

export interface BasketConfig {
  programId: PublicKey;
  shareMint: PublicKey;
  /** Optional basket lookup table (leg mints, vaults, programs) to shrink transactions. */
  lookupTable?: PublicKey;
}

export interface LegView {
  index: number;
  symbol: string;
  name: string;
  mint: PublicKey;
  vault: PublicKey;
  mirrorOf: PublicKey;
  mintInfo: MintInfo;
  vaultInfo: TokenAccountInfo | null;
  state: LegState;
  unavailable: Unavailable[];
  feeNow: TransferFee | null;
  feePending: TransferFee | null;
  multiplier: number;
  status: Basket["legs"][number]["status"];
}

export interface BasketView {
  slot: number;
  epoch: bigint;
  unixTime: number;
  config: BasketConfig;
  address: PublicKey;
  basket: Basket;
  shareSupply: bigint;
  legs: LegView[];
  usdcMintProgram: PublicKey;
  lut: { key: PublicKey; addresses: PublicKey[] } | null;
}

function symbolFor(mirrorOf: PublicKey, i: number): { symbol: string; name: string } {
  const c = CONSTITUENTS.find((x) => x.mainnetMint === mirrorOf.toBase58()) ?? CONSTITUENTS[i];
  return c ? { symbol: c.symbol, name: c.name } : { symbol: `LEG${i}`, name: `Leg ${i}` };
}

export class BasketClient {
  readonly address: PublicKey;
  constructor(readonly conn: Connection, readonly config: BasketConfig) {
    this.address = basketPda(config.programId, config.shareMint)[0];
  }

  async fetchBasket(): Promise<BasketView> {
    const [info, epochInfo] = await Promise.all([
      this.conn.getAccountInfoAndContext(this.address, "confirmed"),
      this.conn.getEpochInfo("confirmed"),
    ]);
    if (!info.value) throw new Error(`basket account ${this.address.toBase58()} not found`);
    const basket = decodeBasket(info.value.data);
    const live = basket.legs.slice(0, basket.nLegs);
    const keys = [basket.shareMint, basket.usdcMint, ...live.flatMap((l) => [l.mint, l.vault])];
    const res = await this.conn.getMultipleAccountsInfoAndContext(keys, "confirmed");
    const accts = res.value;
    const shareMint = accts[0];
    if (!shareMint) throw new Error("share mint missing");
    const shareSupply = parseMint(shareMint.data).supply;
    const usdcMintProgram = accts[1]?.owner ?? TOKEN_PROGRAM_ID;
    const blockTime = (await this.conn.getBlockTime(res.context.slot).catch(() => null)) ?? Math.floor(Date.now() / 1000);
    const legs: LegView[] = live.map((l, i) => {
      const m = accts[2 + 2 * i];
      const v = accts[3 + 2 * i];
      if (!m) throw new Error(`leg ${i} mint missing`);
      const mintInfo = parseMint(m.data);
      const vaultInfo = v ? parseTokenAccount(v.data) : null;
      const unavailable = unavailableReasons(mintInfo, vaultInfo);
      const state: LegState = {
        balance: vaultInfo?.amount ?? 0n,
        accounted: l.accounted,
        claimUnits: l.claimUnits,
        pendingNorm: l.pendingNorm,
        lossIndex: l.lossIndex,
        available: unavailable.length === 0,
        retired: l.status.kind === "Retired",
      };
      return {
        index: i, ...symbolFor(l.mirrorOf, i), mint: l.mint, vault: l.vault, mirrorOf: l.mirrorOf, mintInfo, vaultInfo, state, unavailable,
        feeNow: feeAt(mintInfo, BigInt(epochInfo.epoch)), feePending: pendingFee(mintInfo, BigInt(epochInfo.epoch)),
        multiplier: effectiveMultiplier(mintInfo, blockTime), status: l.status,
      };
    });
    let lut: BasketView["lut"] = null;
    if (this.config.lookupTable) {
      const t = await this.conn.getAddressLookupTable(this.config.lookupTable);
      if (t.value) lut = { key: t.value.key, addresses: t.value.state.addresses };
    }
    return {
      slot: res.context.slot, epoch: BigInt(epochInfo.epoch), unixTime: blockTime, config: this.config, address: this.address,
      basket, shareSupply, legs, usdcMintProgram, lut,
    };
  }

  async shareBalance(owner: PublicKey): Promise<bigint> {
    const a = ata(owner, this.config.shareMint, TOKEN_PROGRAM_ID);
    const info = await this.conn.getAccountInfo(a, "confirmed");
    return info ? parseTokenAccount(info.data).amount : 0n;
  }

  async tokenBalance(owner: PublicKey, mint: PublicKey, program = TOKEN_2022_PROGRAM_ID): Promise<bigint> {
    const info = await this.conn.getAccountInfo(ata(owner, mint, program), "confirmed");
    return info ? parseTokenAccount(info.data).amount : 0n;
  }

  private async ticketsOf<T>(owner: PublicKey | null, disc: Uint8Array, decode: (d: Uint8Array) => T): Promise<{ address: PublicKey; ticket: T }[]> {
    const filters: any[] = [
      { memcmp: { offset: 0, bytes: bs58.encode(disc) } },
      { memcmp: { offset: TICKET_BASKET_OFFSET, bytes: this.address.toBase58() } },
    ];
    if (owner) filters.push({ memcmp: { offset: TICKET_OWNER_OFFSET, bytes: owner.toBase58() } });
    const res = await this.conn.getProgramAccounts(this.config.programId, { commitment: "confirmed", filters });
    return res.map((r) => ({ address: r.pubkey, ticket: decode(r.account.data) }));
  }

  private readonly eventCache = new Map<string, BasketEvent[]>();

  redemptionTickets(owner: PublicKey | null): Promise<{ address: PublicKey; ticket: RedemptionTicket }[]> {
    return this.ticketsOf(owner, ACCOUNT_DISCRIMINATORS.RedemptionTicket, decodeRedemptionTicket);
  }

  /**
   * Every token account owned by a deposit ticket PDA, on both token programs, read from chain.
   * abort/finalize close only the intermediates they're given (spec 02, Known limitation), so the SDK
   * lists what actually exists rather than what it expects.
   */
  async ticketOwnedTokenAccounts(ticket: PublicKey): Promise<{ address: PublicKey; program: PublicKey; mint: PublicKey; amount: bigint }[]> {
    const out: { address: PublicKey; program: PublicKey; mint: PublicKey; amount: bigint }[] = [];
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      const r = await this.conn.getTokenAccountsByOwner(ticket, { programId }, "confirmed");
      for (const a of r.value) {
        const d = a.account.data;
        out.push({ address: a.pubkey, program: programId, mint: new PublicKey(d.subarray(0, 32)), amount: new DataView(d.buffer, d.byteOffset + 64, 8).getBigUint64(0, true) });
      }
    }
    return out;
  }

  depositTickets(owner: PublicKey | null): Promise<{ address: PublicKey; ticket: DepositTicket }[]> {
    return this.ticketsOf(owner, ACCOUNT_DISCRIMINATORS.DepositTicket, decodeDepositTicket);
  }

  /** Program events from the basket's recent transactions (newest first). */
  async recentEvents(limit = 50): Promise<{ signature: string; slot: number; blockTime: number | null; events: BasketEvent[] }[]> {
    const sigs = await this.conn.getSignaturesForAddress(this.address, { limit }, "confirmed");
    const out: { signature: string; slot: number; blockTime: number | null; events: BasketEvent[] }[] = [];
    for (const s of sigs) {
      if (s.err) continue;
      // A confirmed transaction's logs never change: fetch each signature once.
      let events = this.eventCache.get(s.signature);
      if (!events) {
        const tx = await this.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        if (!tx) continue;
        events = parseEventsFromLogs(tx.meta?.logMessages ?? [], this.config.programId);
        this.eventCache.set(s.signature, events);
      }
      if (events.length) out.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, events });
    }
    return out;
  }
}

/** Legs as LegState[] for the maths functions. */
export function legStates(v: BasketView): LegState[] {
  return v.legs.map((l) => l.state);
}
