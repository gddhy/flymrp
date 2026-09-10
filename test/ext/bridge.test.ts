import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { OP_MOV, armBlx, armBx, armDpImm, armLdrImm } from "../helpers/asm.ts";
import { buildArmTableCaller, wordsToBytes } from "../helpers/ext-asm.ts";

describe("4-F ARM → host → ARM bridge", () => {
  it("fixture: return constant", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(4, () => 0x5a);
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, buildArmTableCaller({ dest, slot: 4, r0: 0, r1: 0 }));
    expect(rt.runGuest(dest).r0).toBe(0x5a);
  });

  it("fixture: add R0/R1", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(5, (_c, _m, a) => (a[0] + a[1]) >>> 0);
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, buildArmTableCaller({ dest, slot: 5, r0: 9, r1: 10 }));
    expect(rt.runGuest(dest).r0).toBe(19);
  });

  it("fixture: read AAPCS stack argument", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(6, (_c, _m, a) => a[4] >>> 0);
    const dest = EXT_CODE_ADDR;
    // Preserve the caller LR across BLX without moving the argument stack.
    const words = [
      0xe1a0500e, // mov r5, lr
      armLdrImm(4, 15, 4),
      armBlx(4),
      armBx(5),
      tableSlotAddr(6),
    ];
    rt.pokeCode(dest, wordsToBytes(words));
    const sp = 0x01e7_fff0;
    rt.mem.write32(sp, 0x11223344);
    const out = rt.runGuest(dest, { sp });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0x11223344);
  });

  it("fixture: write output through handler", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(7, (cpu, mem, a) => {
      mem.write32(a[0], 0x0ddba11);
      cpu.r[1] = 4;
      return 0;
    });
    const dest = EXT_CODE_ADDR;
    const buf = 0x0020_4000;
    rt.mem.write32(buf, 0);
    rt.pokeCode(
      dest,
      wordsToBytes([
        0xe1a0500e, // mov r5, lr
        armLdrImm(0, 15, 8),
        armLdrImm(4, 15, 8),
        armBlx(4),
        armBx(5),
        buf,
        tableSlotAddr(7),
      ]),
    );
    // LDR R0 at +4 reads buf at +20; LDR R4 at +8 reads slot at +24.
    void OP_MOV;
    const out = rt.runGuest(dest);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
    expect(rt.mem.read32(buf)).toBe(0x0ddba11);
  });
});
