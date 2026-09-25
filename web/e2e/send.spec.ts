import { test, expect } from "@playwright/test";
import { sendOne } from "../app/app/_holder/send";

// Retry logic for sending a flow's signed transactions (app/app/_holder/send.ts), against a fake RPC.
// Broken version: SEND_BROKEN=1 allows a single attempt; the transient-failure case must then fail.
const attempts = process.env.SEND_BROKEN ? 1 : 6;
const tx = { serialize: () => new Uint8Array([1, 2, 3]), message: { recentBlockhash: "11111111111111111111111111111111" } } as any;

function fakeConn(errors: string[], blockhashValid = true) {
  let calls = 0;
  return {
    calls: () => calls,
    conn: {
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
