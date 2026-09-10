import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF, EXT_CODE_ADDR } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ARM_LOAD_HELPER_OFF, assembleArmHelperAt, buildArmLoadImage } from "../helpers/ext-asm.ts";

function loadWrapperWithChild(rt: ExtRuntime, childDest: number, grandchildDest?: number) {
  const wrapHelper = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
  const childHelper = childDest + ARM_LOAD_HELPER_OFF;
  const childOpts: Parameters<typeof assembleArmHelperAt>[1] = {
    ret0: 0x30,
    ret1: 0x31,
    ret6: 0x36,
    ret8: 0x38,
  };
  if (grandchildDest !== undefined) childOpts.childLoad = grandchildDest + 8;
  rt.load(
    buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(wrapHelper, {
        ret0: 0x20,
        ret1: 0x21,
        ret6: 0x26,
        ret8: 0x28,
        childLoad: childDest + 8,
      }),
    }),
  );
  rt.load(
    buildArmLoadImage({
      dest: childDest,
      helperWords: assembleArmHelperAt(childHelper, childOpts),
    }),
    { dest: childDest, stage: true, runLoad: false },
  );
  if (grandchildDest !== undefined) {
    const gHelper = grandchildDest + ARM_LOAD_HELPER_OFF;
    rt.load(
      buildArmLoadImage({
        dest: grandchildDest,
        helperWords: assembleArmHelperAt(gHelper, { ret0: 0x40, ret1: 0x41, ret6: 0x46, ret8: 0x48 }),
      }),
      { dest: grandchildDest, stage: true, runLoad: false },
    );
  }
}

describe("4-G Nested EXT", () => {
  it("fixture: 2-level wrapper → primary", () => {
    const rt = new ExtRuntime();
    const childDest = 0x0020_5000;
    loadWrapperWithChild(rt, childDest);
    expect(rt.owners.wrapper.helper).toBe(EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF);
    expect(rt.owners.primary.helper).toBe(0);
    const out = rt.arm_ext_call(6);
    expect(out.kind).toBe("return");
    expect(rt.owners.primary.helper).toBe(childDest + ARM_LOAD_HELPER_OFF);
    expect(rt.owners.active.helper).toBe(childDest + ARM_LOAD_HELPER_OFF);
    expect(rt.owners.nested.length).toBe(1);
    expect(rt.owners.wrapper.p).not.toBe(rt.owners.primary.p);
    expect(rt.mem.read32(rt.owners.wrapper.p + AEX_P_ER_RW_OFF)).not.toBe(
      rt.mem.read32(rt.owners.primary.p + AEX_P_ER_RW_OFF),
    );
    expect(rt.arm_ext_call(0).r0).toBe(0x30);
    expect(rt.arm_ext_call(1).r0).toBe(0x21);
    expect(rt.owners.depth()).toBe(0);
  });

  it("fixture: 3-level wrapper → primary → child", () => {
    const rt = new ExtRuntime();
    const primaryDest = 0x0020_6000;
    const childDest = 0x0020_7000;
    loadWrapperWithChild(rt, primaryDest, childDest);
    rt.arm_ext_call(6);
    expect(rt.owners.primary.helper).toBe(primaryDest + ARM_LOAD_HELPER_OFF);
    expect(rt.owners.nested.length).toBe(1);
    const mid = rt.arm_ext_call(0);
    expect(mid.r0).toBe(0x30);
    rt.owners.active = { ...rt.owners.primary };
    const third = rt.arm_ext_call(6);
    expect(third.kind).toBe("return");
    expect(rt.owners.nested.length).toBe(2);
    expect(rt.owners.active.helper).toBe(childDest + ARM_LOAD_HELPER_OFF);
    expect(rt.owners.primary.helper).toBe(primaryDest + ARM_LOAD_HELPER_OFF);
    expect(rt.owners.wrapper.helper).toBe(EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF);
    expect(rt.arm_ext_call(8).r0).toBe(0x48);
    expect(rt.arm_ext_call(1).r0).toBe(0x21);
  });

  it("fixture: six owners stay distinct", () => {
    const rt = new ExtRuntime();
    rt.installModule("wrapper", 0x10, 0x11);
    rt.installModule("primary", 0x20, 0x21);
    rt.installModule("active", 0x30, 0x31);
    rt.installModule("timer", 0x40, 0x41);
    rt.installModule("screen", 0x50, 0x51);
    rt.owners.current = { p: 0x60, helper: 0x61 };
    expect(rt.owners.wrapper.p).toBe(0x10);
    expect(rt.owners.primary.p).toBe(0x20);
    expect(rt.owners.active.p).toBe(0x30);
    expect(rt.owners.timer.p).toBe(0x40);
    expect(rt.owners.screen.p).toBe(0x50);
    expect(rt.owners.current.p).toBe(0x60);
  });
});
