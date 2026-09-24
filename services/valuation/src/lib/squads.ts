// Squads v4 Multisig account decoding (layout verified against the live PreStocks multisig
// 53Ab3Rqx…: threshold 2, 7 members, time lock 0, as recorded in docs/phase0.md).

import { PublicKey } from "./web3.ts";

export interface MultisigView {
  address: string;
  create_key: string;
  config_authority: string | null;
  threshold: number;
  time_lock_s: number;
  transaction_index: string;
  stale_transaction_index: string;
  members: { key: string; permissions: string[] }[];
  voters: number;
  vault_index0: string;
}

const PERMS = ["initiate", "vote", "execute"];

export function decodeMultisig(address: string, data: Buffer): MultisigView {
  let o = 8;
  const key = () => { const k = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32; return k; };
  const create_key = key();
  const cfg = key();
  const threshold = data.readUInt16LE(o); o += 2;
  const time_lock_s = data.readUInt32LE(o); o += 4;
  const transaction_index = data.readBigUInt64LE(o).toString(); o += 8;
  const stale_transaction_index = data.readBigUInt64LE(o).toString(); o += 8;
  if (data[o++]) o += 32; // rent_collector: Option<Pubkey>
  o += 1; // bump
  const n = data.readUInt32LE(o); o += 4;
  const members = [];
  for (let i = 0; i < n; i++) {
    const k = key();
    const mask = data[o++];
    members.push({ key: k, permissions: PERMS.filter((_, b) => mask & (1 << b)) });
  }
  const vault = PublicKey.findProgramAddressSync(
    [Buffer.from("multisig"), new PublicKey(address).toBuffer(), Buffer.from("vault"), Buffer.from([0])],
    new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"),
  )[0].toBase58();
  return {
    address, create_key, config_authority: cfg === "11111111111111111111111111111111" ? null : cfg, threshold, time_lock_s,
    transaction_index, stale_transaction_index, members, voters: members.filter((m) => m.permissions.includes("vote")).length, vault_index0: vault,
  };
}
