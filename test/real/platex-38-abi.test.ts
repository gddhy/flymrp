import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { UnknownAbiError } from "../../src/err/errors.ts";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MR_PLATEX_CODE_4C6, MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

/**
 * This is rxgj FULL compatibility behavior for the observed
 * mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL) call.
 *
 * It is not claimed to implement the complete mr_platEx API
 * or universal Mythroad platform behavior.
 */

function wire(): { ext: ExtRuntime; bridge: MrTableBridge } {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call38(
  ext: ExtRuntime,
  r0: number,
  r1: number,
  r2: number,
  r3: number,
  stack0: number,
  stack4: number,
) {
  const sp = (stackTop() - 16) >>> 0;
  ext.mem.write32(sp, stack0 >>> 0);
  ext.mem.write32((sp + 4) >>> 0, stack4 >>> 0);
  return ext.runGuest(tableSlotAddr(38), {
    r0,
    r1,
    r2,
    r3,
    sp,
    lr: EXT_STOP_ADDR,
  });
}

describe("5-C.10C table[38] mr_platEx code 0x4c6 ABI", () => {
  it("rxgj MR_SUCCESS is 0", () => {
    expect(MR_SUCCESS).toBe(0);
    expect(MR_PLATEX_CODE_4C6).toBe(0x4c6);
  });

  it("6-arg platEx(0x4c6, NULL, 0, NULL, NULL, NULL) → MR_SUCCESS", () => {
    const { ext } = wire();
    const out = call38(ext, MR_PLATEX_CODE_4C6, 0, 0, 0, 0, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
  });

  it("direct 6-parameter AAPCS vector: r0-r3 + [sp] + [sp+4]", () => {
    const { bridge } = wire();
    const args = new Uint32Array(8);
    args[0] = MR_PLATEX_CODE_4C6;
    args[1] = 0;
    args[2] = 0;
    args[3] = 0;
    args[4] = 0;
    args[5] = 0;
    expect(bridge.platEx(args)).toBe(MR_SUCCESS);
  });

  it("unused input/output/cb pointers do not change 0x4c6 (no side effects)", () => {
    const { ext, bridge } = wire();
    const args = new Uint32Array([MR_PLATEX_CODE_4C6, 0x11111111, 4, 0x22222222, 0x33333333, 0x44444444]);
    expect(bridge.platEx(args)).toBe(MR_SUCCESS);
    expect(call38(ext, MR_PLATEX_CODE_4C6, 0x11111111, 4, 0x22222222, 0x33333333, 0x44444444).r0).toBe(MR_SUCCESS);
  });

  it("unknown platEx code is UnknownAbiError, not default MR_SUCCESS", () => {
    const { ext } = wire();
    for (const code of [0, 1, 0x4c7, 0x4b4, 1222 + 1]) {
      try {
        call38(ext, code, 0, 0, 0, 0, 0);
        throw new Error(`code ${code} should throw`);
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownAbiError);
        const u = e as UnknownAbiError;
        expect(u.family).toBe("mr_platEx");
        expect(u.code).toBe(code);
        expect(u.message).toBe(`unsupported mr_platEx code ${code}`);
      }
    }
  });

  it("registers table[38] only for 0x4c6; table[33] is getTime", () => {
    const { ext } = wire();
    expect(!!ext.table.handlers[38]).toBe(true);
    expect(!!ext.table.handlers[33]).toBe(true);
    expect(!!ext.table.handlers[130]).toBe(true);
  });
});
