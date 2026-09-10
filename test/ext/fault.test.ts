import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR, EXT_STOP_ADDR, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtStopKind, ExtStopped, isExtStopped } from "../../src/abi/fault.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { armB, armBx, armLdrImm } from "../helpers/asm.ts";
import { wordsToBytes } from "../helpers/ext-asm.ts";

describe("4-I stop / fault boundary", () => {
  it("fixture: normal return via EXT_STOP_ADDR + LR", () => {
    const rt = new ExtRuntime();
    rt.pokeCode(EXT_CODE_ADDR, wordsToBytes([armBx(14)]));
    const out = rt.runGuest(EXT_CODE_ADDR, { lr: EXT_STOP_ADDR });
    expect(out.kind).toBe(ExtStopKind.Return);
  });

  it("fixture: explicit branch to STOP completes at the EXT boundary", () => {
    const rt = new ExtRuntime();
    const dest = EXT_CODE_ADDR;
    const off = ((EXT_STOP_ADDR - (dest + 8)) >> 2) & 0xff_ffff;
    rt.pokeCode(dest, wordsToBytes([armB(off)]));
    const out = rt.runGuest(dest, { lr: 0x01e8_0100 });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(rt.cpu.r[15] >>> 0).toBe(EXT_STOP_ADDR);
  });

  it("fixture: unsupported instruction is not treated as success", () => {
    const rt = new ExtRuntime();
    rt.pokeCode(EXT_CODE_ADDR, wordsToBytes([0xe7f000f0]));
    const out = rt.runGuest(EXT_CODE_ADDR);
    expect(out.kind).toBe(ExtStopKind.Unsupported);
  });

  it("fixture: unmapped fetch is Unmapped, not a compatibility success", () => {
    const rt = new ExtRuntime();
    rt.pokeCode(EXT_CODE_ADDR, wordsToBytes([armLdrImm(15, 15, 0)]));
    // LDR PC, [PC] will read dest+8 which we can set to unmapped
    rt.mem.write32(EXT_CODE_ADDR + 8, 0x3000_0000);
    const out = rt.runGuest(EXT_CODE_ADDR);
    expect(out.kind === ExtStopKind.Unmapped || out.kind === ExtStopKind.Unsupported).toBe(true);
  });

  it("fixture: invalid table slot is a distinct ABI fault", () => {
    const rt = new ExtRuntime();
    rt.pokeCode(EXT_CODE_ADDR, wordsToBytes([armLdrImm(0, 15, 0), armBx(0), tableSlotAddr(100)]));
    const out = rt.runGuest(EXT_CODE_ADDR);
    expect(out.kind).toBe(ExtStopKind.InvalidSlot);
  });

  it("recognizes a normal EXT return even when instanceof Error-subclass is broken", () => {
    const lost = new ExtStopped(ExtStopKind.Return, EXT_STOP_ADDR);
    Object.setPrototypeOf(lost, Error.prototype);
    expect(lost instanceof ExtStopped).toBe(false);
    expect(isExtStopped(lost)).toBe(true);
    expect(isExtStopped(new Error("EXT return at 0x7fff0"))).toBe(true);
  });

  it("fixture: missing helper is AbiFault", () => {
    const rt = new ExtRuntime();
    const out = rt.arm_ext_call(0);
    expect(out.kind).toBe(ExtStopKind.AbiFault);
  });
});
