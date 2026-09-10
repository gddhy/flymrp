import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge, atoi2 } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

function call18(ext: ExtRuntime, p: number) {
  return ext.runGuest(tableSlotAddr(18), {
    r0: p,
    r1: 0,
    r2: 0,
    r3: 0,
    sp: stackTop() - 16,
    lr: EXT_STOP_ADDR,
  });
}

describe("table[18] atoi2 ABI", () => {
  it("LIVE IMSI prefix 000 is 0", () => {
    const ext = new ExtRuntime();
    new MrTableBridge(ext, new MythroadVfs(), "test").install();
    const p = ext.alloc(8);
    writeCString(ext, p, "000");
    const out = call18(ext, p);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
  });

  it("matches rxgj atol2: minus, no whitespace, no plus", () => {
    const ext = new ExtRuntime();
    const p = ext.alloc(16);
    writeCString(ext, p, "-12x");
    expect(atoi2(ext.mem, p)).toBe(-12);
    writeCString(ext, p, " 1");
    expect(atoi2(ext.mem, p)).toBe(0);
    writeCString(ext, p, "+1");
    expect(atoi2(ext.mem, p)).toBe(0);
    writeCString(ext, p, "460");
    expect(atoi2(ext.mem, p)).toBe(460);
  });
});
