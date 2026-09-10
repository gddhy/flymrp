import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { UnknownAbiError } from "../../src/err/errors.ts";
import { MR_TESTCOM_CASE7, MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire(): ExtRuntime {
  const ext = new ExtRuntime();
  new MrTableBridge(ext, new MythroadVfs(), "test").install();
  return ext;
}

function call130(ext: ExtRuntime, r0: number, r1: number, r2: number, r3: number) {
  return ext.runGuest(tableSlotAddr(130), {
    r0,
    r1,
    r2,
    r3,
    lr: EXT_STOP_ADDR,
  });
}

describe("5-C.10B table[130] case 7 ABI", () => {
  it("R1=7 R2=0x270f → R0=0x270f (rxgj FULL case 7)", () => {
    const ext = wire();
    const out = call130(ext, 0, MR_TESTCOM_CASE7, 0x270f, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0x270f);
  });

  it("R1=7 R2=0 → R0=0", () => {
    const ext = wire();
    expect(call130(ext, 0, 7, 0, 0).r0).toBe(0);
  });

  it("R1=7 returns exact input1 for arbitrary int32", () => {
    const ext = wire();
    expect(call130(ext, 0, 7, 0x12345678, 0).r0).toBe(0x12345678);
    expect(call130(ext, 0, 7, 0x7fffffff, 0).r0).toBe(0x7fffffff);
    expect(call130(ext, 0, 7, 0x80000000, 0).r0).toBe(0x80000000);
    expect(call130(ext, 0, 7, 0xffffffff, 0).r0).toBe(0xffffffff);
  });

  it("ignores guest R0 and R3", () => {
    const ext = wire();
    const out = call130(ext, 0x11111111, 7, 0x270f, 0x33333333);
    expect(out.r0).toBe(0x270f);
  });

  it("input0 != 7 is unsupported TestCom, not a default return", () => {
    const ext = wire();
    for (const input0 of [0, 1, 6, 8, 9999]) {
      try {
        call130(ext, 0, input0, 0x270f, 0);
        throw new Error(`case ${input0} should throw`);
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownAbiError);
        const u = e as UnknownAbiError;
        expect(u.family).toBe("_mr_TestCom");
        expect(u.code).toBe(input0);
        expect(u.message).toBe(`unsupported TestCom case ${input0}`);
      }
    }
  });

  it("registers table[38] code 0x4c6 and table[33] getTime", () => {
    const ext = wire();
    expect(!!ext.table.handlers[130]).toBe(true);
    expect(!!ext.table.handlers[38]).toBe(true);
    expect(!!ext.table.handlers[33]).toBe(true);
  });
});
