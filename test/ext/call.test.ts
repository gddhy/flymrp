import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF, EXT_CODE_ADDR, EXT_STOP_ADDR, stackTop } from "../../src/abi/layout.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ARM_LOAD_HELPER_OFF, assembleArmHelperAt, buildArmLoadImage, buildThumbCodeHelper, buildThumbLoadImage } from "../helpers/ext-asm.ts";

describe("4-E host → EXT arm_ext_call", () => {
  function loadArm(rt: ExtRuntime, helperOpts: Parameters<typeof assembleArmHelperAt>[1]) {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const image = buildArmLoadImage({ dest: EXT_CODE_ADDR, helperWords: assembleArmHelperAt(helperAt, helperOpts) });
    rt.load(image);
    return helperAt;
  }

  it("fixture: ARM EXT entry sets R0-R3 / R9 / SP / LR / PC / T", () => {
    const rt = new ExtRuntime();
    loadArm(rt, { storeR9ToR2: true, ret1: 0x21, ret6: 0x26, ret8: 0x28 });
    const input = new Uint8Array(8);
    const snap: {
      r0: number;
      r1: number;
      r2: number;
      r3: number;
      r9: number;
      sp: number;
      lr: number;
      t: number;
    }[] = [];
    const helper = rt.owners.wrapper.helper;
    const orig = rt.cpu.onBeforeFetch;
    rt.cpu.onBeforeFetch = (cpu) => {
      if ((cpu.r[15] >>> 0) === (helper & ~1) && snap.length === 0) {
        snap.push({
          r0: cpu.r[0] >>> 0,
          r1: cpu.r[1] >>> 0,
          r2: cpu.r[2] >>> 0,
          r3: cpu.r[3] >>> 0,
          r9: cpu.r[9] >>> 0,
          sp: cpu.r[13] >>> 0,
          lr: cpu.r[14] >>> 0,
          t: cpu.t,
        });
      }
      return orig!(cpu);
    };
    const out = rt.arm_ext_call(0, input);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(snap).toHaveLength(1);
    const s = snap[0]!;
    expect(s.r0).toBe(rt.owners.wrapper.p);
    expect(s.r1).toBe(0);
    expect(s.r3).toBe(input.length);
    expect(s.r9).toBe(rt.mem.read32(rt.owners.wrapper.p + AEX_P_ER_RW_OFF));
    expect(s.sp).toBe((stackTop() - 16) >>> 0);
    expect(s.lr).toBe(EXT_STOP_ADDR);
    expect(s.t).toBe(0);
    expect(rt.mem.read32(s.sp)).toBeGreaterThan(0);
    expect(rt.mem.read32(s.r2)).toBe(s.r9);
  });

  it("fixture: code 0 / 1 / 6 / 8 and wrapper-first code 1", () => {
    const rt = new ExtRuntime();
    loadArm(rt, { ret0: 0x20, ret1: 0x21, ret6: 0x26, ret8: 0x28 });
    const p = rt.alloc(20);
    const rw = rt.alloc(64);
    rt.writeP(p, rw, 64);
    const helper = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    rt.installModule("primary", p, helper + 0, rw, 64);
    // same helper body; distinguish via install of a second helper
    const primaryHelper = helper;
    rt.owners.primary.helper = primaryHelper;
    // wrapper-first: give primary a different helper that returns 0x31 for code 1
    const childDest = 0x0020_1000;
    const childHelper = childDest + ARM_LOAD_HELPER_OFF;
    rt.pokeCode(
      childDest,
      buildArmLoadImage({
        dest: childDest,
        helperWords: assembleArmHelperAt(childHelper, { ret0: 0x30, ret1: 0x31, ret6: 0x36, ret8: 0x38 }),
      }),
    );
    rt.installModule("primary", p, childHelper, rw, 64);
    expect(rt.arm_ext_call(0).r0).toBe(0x30);
    expect(rt.arm_ext_call(1).r0).toBe(0x21);
    expect(rt.arm_ext_call(6).r0).toBe(0x26);
    expect(rt.arm_ext_call(8).r0).toBe(0x28);
    expect(rt.routeCall(1).helper).toBe(rt.owners.wrapper.helper);
    expect(rt.routeCall(0).helper).toBe(childHelper);
    expect(rt.routeCall(6).helper).toBe(rt.owners.active.helper || rt.owners.wrapper.helper);
  });

  it("fixture: Thumb EXT entry returns via helper", () => {
    const rt = new ExtRuntime();
    const image = buildThumbLoadImage({
      dest: EXT_CODE_ADDR,
      helperHalfs: buildThumbCodeHelper({ ret0: 0x10, ret1: 0x11, ret6: 0x16, ret8: 0x18 }),
    });
    rt.load(image, { thumb: true });
    expect(rt.owners.wrapper.helper & 1).toBe(1);
    expect(rt.arm_ext_call(0).r0).toBe(0x10);
    expect(rt.arm_ext_call(1).r0).toBe(0x11);
    expect(rt.cpu.t).toBe(0);
  });

  it("fixture: output pointer / length on the helper stack", () => {
    const rt = new ExtRuntime();
    loadArm(rt, { writeOutput: true });
    const input = Uint8Array.from([1, 2, 3, 4]);
    const out = rt.arm_ext_call(0, input);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.outputAddr).toBeGreaterThan(0);
    expect(out.outputLen).toBe(4);
    expect([...out.output]).toEqual([1, 2, 3, 4]);
  });

  it("fixture: code 6 / 8 do not use the 0..5 primary shortcut", () => {
    const rt = new ExtRuntime();
    loadArm(rt, { ret0: 0x20, ret1: 0x21, ret6: 0x26, ret8: 0x28 });
    const p = rt.alloc(20);
    const rw = rt.alloc(32);
    rt.writeP(p, rw, 32);
    const childDest = 0x0020_2000;
    const childHelper = childDest + ARM_LOAD_HELPER_OFF;
    rt.pokeCode(
      childDest,
      buildArmLoadImage({
        dest: childDest,
        helperWords: assembleArmHelperAt(childHelper, { ret0: 0x30, ret1: 0x31, ret6: 0x36, ret8: 0x38 }),
      }),
    );
    rt.installModule("primary", p, childHelper, rw, 32);
    expect(rt.routeCall(6).helper).not.toBe(childHelper);
    expect(rt.routeCall(8).helper).not.toBe(childHelper);
    expect(rt.routeCall(6).helper).toBe(rt.owners.wrapper.helper);
    expect(rt.arm_ext_call(6).r0).toBe(0x26);
    expect(rt.arm_ext_call(8).r0).toBe(0x28);
  });
});
