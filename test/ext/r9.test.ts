import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF, EXT_CODE_ADDR } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ARM_LOAD_HELPER_OFF, assembleArmHelperAt, buildArmLoadImage } from "../helpers/ext-asm.ts";

describe("4-C R9 / ER_RW", () => {
  it("fixture: module entry sets R9 = P.ER_RW and restores caller R9", () => {
    const rt = new ExtRuntime();
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    rt.load(
      buildArmLoadImage({
        dest: EXT_CODE_ADDR,
        helperWords: assembleArmHelperAt(helperAt, { storeR9ToR2: true }),
      }),
    );
    const callerR9 = 0x1234_0000;
    rt.cpu.r[9] = callerR9;
    const input = new Uint8Array(4);
    const out = rt.arm_ext_call(0, input);
    const rw = rt.mem.read32(rt.owners.wrapper.p + AEX_P_ER_RW_OFF);
    expect(out.kind).toBe("return");
    expect(rw).toBeGreaterThan(0);
    expect(rt.cpu.r[9] >>> 0).toBe(callerR9);
  });

  it("fixture: GOT uses module-owned ER_RW", () => {
    const rt = new ExtRuntime();
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    rt.load(
      buildArmLoadImage({
        dest: EXT_CODE_ADDR,
        helperWords: assembleArmHelperAt(helperAt, { storeR9ToRw: true }),
      }),
    );
    const rw = rt.mem.read32(rt.owners.wrapper.p + AEX_P_ER_RW_OFF);
    rt.mem.write32(rw, 0);
    rt.arm_ext_call(0);
    expect(rt.mem.read32(rw)).toBe(rw);
  });

  it("fixture: nested module call restores parent R9", () => {
    const rt = new ExtRuntime();
    const childDest = 0x0020_3000;
    const childHelper = childDest + ARM_LOAD_HELPER_OFF;
    const childLoad = childDest + 8;
    const wrapHelper = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    rt.load(
      buildArmLoadImage({
        dest: EXT_CODE_ADDR,
        helperWords: assembleArmHelperAt(wrapHelper, {
          ret0: 0x20,
          ret1: 0x21,
          ret6: 0x26,
          childLoad: childLoad,
        }),
      }),
    );
    rt.load(
      buildArmLoadImage({
        dest: childDest,
        helperWords: assembleArmHelperAt(childHelper, { storeR9ToR2: true, ret0: 0x30 }),
      }),
      { dest: childDest, stage: true, runLoad: false },
    );
    const parentRw = rt.mem.read32(rt.owners.wrapper.p + AEX_P_ER_RW_OFF);
    rt.cpu.r[9] = parentRw;
    const loadOut = rt.arm_ext_call(6);
    expect(loadOut.kind).toBe("return");
    expect(rt.owners.primary.helper).toBe(childHelper);
    expect(rt.cpu.r[9] >>> 0).toBe(parentRw);
    const childRw = rt.mem.read32(rt.owners.primary.p + AEX_P_ER_RW_OFF);
    expect(childRw).not.toBe(parentRw);
    const input = new Uint8Array(4);
    rt.arm_ext_call(0, input);
    expect(rt.cpu.r[9] >>> 0).toBe(parentRw);
  });
});
