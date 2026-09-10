import { describe, expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { EXT_STOP_ADDR } from "../../src/abi/layout.ts";
import { CpuTrap } from "../../src/hot/cpu.ts";
import { decodeThumb16 } from "../../src/hot/decode-thumb16.ts";
import { Op } from "../../src/hot/opcodes.ts";

describe("Thumb semihost debug ABI", () => {
  it("decodes DF as SVC and DE as undefined", () => {
    const out = new Uint32Array(3);
    decodeThumb16(0xdfab, out, 0);
    expect(out[0] & 255).toBe(Op.SVC);
    expect(out[1]).toBe(0xab);
    decodeThumb16(0xdeab, out, 0);
    expect(out[0] & 255).toBe(Op.UNDEF);
  });
  it("SYS_WRITEC reads a guest byte and resumes at the following instruction", () => {
    const rt = new ExtRuntime(), code = rt.alloc(8), char = rt.alloc(1);
    rt.mem.write8(char, 65);
    rt.pokeCode(code, [0xab, 0xdf, 0x07, 0x20, 0x70, 0x47]);
    const out = rt.runGuest(code | 1, { r0: 3, r1: char, lr: EXT_STOP_ADDR });
    expect(out.kind).toBe("return");
    expect(out.r0).toBe(7);
    expect(rt.debugOutput).toBe("A");
  });
  it("unknown semihost operations still trap and invalid pointers still fault", () => {
    const rt = new ExtRuntime(), code = rt.alloc(4);
    rt.pokeCode(code, [0xab, 0xdf, 0x70, 0x47]);
    expect(() => rt.runGuest(code | 1, { r0: 99, lr: EXT_STOP_ADDR })).toThrow(CpuTrap);
    const out = rt.runGuest(code | 1, { r0: 3, r1: 0xffffffff, lr: EXT_STOP_ADDR });
    expect(out.kind).toBe("unmapped");
  });
  it("recognizes ARM SYS_EXIT without executing following guest instructions", () => {
    const rt = new ExtRuntime(), code = rt.alloc(12);
    rt.mem.write32(code, 0xef123456); rt.mem.write32(code+4, 0xe3a00007); rt.mem.write32(code+8, 0xe12fff1e);
    let exits=0; rt.onGuestExit=()=>{exits++;};
    expect(rt.runGuest(code,{r0:0x18,r1:0x20026}).r0).toBe(0);
    expect(exits).toBe(1); expect(rt.guestExitCode).toBe(0);
    expect(rt.runGuest(code,{r0:0x18,r1:0x20023}).r0).toBe(1);
    expect(rt.guestExitCode).toBe(1);
  });

});
