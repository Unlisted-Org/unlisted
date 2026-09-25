import { test, expect } from "@playwright/test";
import { confirmFast, sendOne } from "../app/app/_holder/send";

// Retry logic for sending a flow's signed transactions (app/app/_holder/send.ts), against a fake RPC.
// Broken version: SEND_BROKEN=1 allows a single attempt; the transient-failure case must then fail.
const attempts = process.env.SEND_BROKEN ? 1 : 6;
const tx = { serialize: () => new Uint8Array([1, 2, 3]), message: { recentBlockhash: "11111111111111111111111111111111" } } as any;

function fakeConn(errors: string[], blockhashValid = true, height = 100) {
  let calls = 0;
  return {
    calls: () => calls,
    conn: {
      getBlockHeight: async () => height,
      sendRawTransaction: async () => { calls++; const e = errors.shift(); if (e) throw new Error(e); return "SIG"; },
      isBlockhashValid: async () => ({ value: blockhashValid }),
      getSignatureStatuses: async () => ({ value: [null] }),
    } as any,
  };
}

test("a transient 'Blockhash not found' is retried with the same signed bytes", async () => {
  const f = fakeConn(["Simulation failed. Message: Transaction simulation failed: Blockhash not found.", "Blockhash not found"]);
  const retries: string[] = [];
  await expect(sendOne(f.conn, tx, 0, { attempts, delayMs: () => 1, onRetry: (_i, _a, why) => retries.push(why) })).resolves.toBe("SIG");
  expect(f.calls()).toBe(3);
  expect(retries).toHaveLength(2);
});

test("a program error is never retried", async () => {
  const f = fakeConn(["Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1771"]);
  await expect(sendOne(f.conn, tx, 0, { attempts, delayMs: () => 1 })).rejects.toThrow(/0x1771/);
  expect(f.calls()).toBe(1);
});

test("an expired blockhash stops the retries and asks for a new signature", async () => {
  const f = fakeConn(["429 Too Many Requests", "429 Too Many Requests"], false);
  await expect(sendOne(f.conn, tx, 0, { attempts, delayMs: () => 1 })).rejects.toThrow(/expired|429/);
  expect(f.calls()).toBe(1);
});

// The blockhash's last valid height decides expiry: "Blockhash not found" from an expired blockhash is
// not retried for half a minute, it stops at once. (Mutant: pastValidHeight always false -> these fail.)
test("past the last valid block height, 'Blockhash not found' stops at once", async () => {
  const f = fakeConn(Array(6).fill("Transaction simulation failed: Blockhash not found"), true, 500);
  await expect(sendOne(f.conn, tx, 0, { attempts: 6, delayMs: () => 1, lastValidBlockHeight: 400 })).rejects.toThrow(/expired/);
  expect(f.calls(), "sends before giving up").toBe(1);
});

test("confirmation gives up as soon as the blockhash is dead, not after two minutes", async () => {
  const f = fakeConn([], true, 500);
  const t0 = Date.now();
  await expect(confirmFast(f.conn, "SIG", new Uint8Array([1]), 0, { pollMs: 5, lastValidBlockHeight: 400 })).rejects.toThrow(/expired/);
  expect(Date.now() - t0, "ms until it gave up").toBeLessThan(2_000);
});
