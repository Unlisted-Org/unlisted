// The SDK's Token-2022 parser against real mint accounts, checked field by field against the
// RPC node's own jsonParsed decoding of the same account at the same slot (an independent decoder).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMint, feeAt, pendingFee, effectiveMultiplier, unavailableReasons, transferFee, grossForNet } from "../src/token2022.js";

const load = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url)), "utf8"));

for (const name of ["mainnet-openai", "devnet-fixture"]) {
  describe(`parseMint: ${name}`, () => {
    const raw = load(`mint-${name}.base64.json`).result;
    const parsed = load(`mint-${name}.jsonParsed.json`).result.value[0].data.parsed.info;
    const ext = (n: string) => parsed.extensions.find((e: any) => e.extension === n)?.state;
    const info = parseMint(new Uint8Array(Buffer.from(raw.value[0].data[0], "base64")));

    it("base fields", () => {
      expect(info.decimals).toBe(parsed.decimals);
      expect(info.supply.toString()).toBe(parsed.supply);
      expect(info.extensions.length).toBe(parsed.extensions.length);
    });
    it("transfer fee schedule", () => {
      const tf = ext("transferFeeConfig");
      expect(info.transferFee!.older.bps).toBe(tf.olderTransferFee.transferFeeBasisPoints);
      expect(info.transferFee!.newer.bps).toBe(tf.newerTransferFee.transferFeeBasisPoints);
      expect(info.transferFee!.newer.epoch.toString()).toBe(String(tf.newerTransferFee.epoch));
      // JSON numbers lose precision above 2^53; compare as float and check the exact u64::MAX separately.
      expect(Number(info.transferFee!.newer.maximumFee)).toBe(tf.newerTransferFee.maximumFee);
      expect(info.transferFee!.newer.maximumFee).toBe(2n ** 64n - 1n);
    });
    it("pause, hook, delegate, default state, scaled UI", () => {
      expect(info.paused).toBe(ext("pausableConfig").paused);
      expect(info.hookProgram?.toBase58() ?? null).toBe(ext("transferHook").programId);
      expect(info.permanentDelegate?.toBase58()).toBe(ext("permanentDelegate").delegate);
      expect(info.defaultAccountState).toBe({ initialized: 1, frozen: 2 }[ext("defaultAccountState").accountState as string]);
      const s = ext("scaledUiAmountConfig");
      expect(info.scaledUi!.multiplier).toBe(Number(s.multiplier));
      expect(info.scaledUi!.newMultiplier).toBe(Number(s.newMultiplier));
      expect(info.scaledUi!.newMultiplierEffectiveTimestamp.toString()).toBe(String(s.newMultiplierEffectiveTimestamp));
    });
  });
}

describe("fee and multiplier helpers on the real OpenAI mint", () => {
  const raw = load("mint-mainnet-openai.base64.json").result;
  const info = parseMint(new Uint8Array(Buffer.from(raw.value[0].data[0], "base64")));
  it("300 bps from epoch 1043, 100 bps before (docs/risks.md §1)", () => {
    expect(feeAt(info, 1042n)!.bps).toBe(100);
    expect(pendingFee(info, 1042n)).toMatchObject({ bps: 300, epoch: 1043n });
    expect(feeAt(info, 1043n)!.bps).toBe(300);
    expect(pendingFee(info, 1043n)).toBeNull();
  });
  it("effective multiplier uses newMultiplier once its timestamp has passed (the stored field alone is the bug)", () => {
    expect(info.scaledUi!.multiplier).toBe(1);
    expect(effectiveMultiplier(info, 1_790_000_000)).toBeCloseTo(1.4861347, 7);
    expect(effectiveMultiplier(info, 1_700_000_000)).toBe(1);
  });
  it("available: not paused, no hook, initialized vault", () => {
    expect(unavailableReasons(info, { state: 1 } as any)).toEqual([]);
    expect(unavailableReasons({ ...info, paused: true }, { state: 2 } as any)).toEqual(["paused", "frozen"]);
  });
});

describe("transfer fee maths (ceil, uncapped as PreStocks' maximumFee = u64::MAX)", () => {
  it("matches the model's ceil and inverts exactly", () => {
    const fee = { bps: 300, maximumFee: 2n ** 64n - 1n };
    expect(transferFee(1n, fee)).toBe(1n);
    expect(transferFee(10_000n, fee)).toBe(300n);
    expect(transferFee(10_001n, fee)).toBe(301n);
    for (const net of [1n, 97n, 999_999n, 123_456_789_012n]) {
      const g = grossForNet(net, fee);
      expect(g - transferFee(g, fee) >= net).toBe(true);
      expect(g - 1n - transferFee(g - 1n, fee) < net).toBe(true);
    }
  });
});
