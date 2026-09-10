import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge, strlen2 } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

describe("table[15] strlen2 ABI", () => {
  it("counts bytes until NUL", () => {
    const ext = new ExtRuntime();
    new MrTableBridge(ext, new MythroadVfs(), "test").install();
    const p = ext.alloc(16);
    writeCString(ext, p, "000000000000000");
    const out = ext.runGuest(tableSlotAddr(15), {
      r0: p,
      r1: 0x0001003c,
      r2: 0x20,
      r3: 0,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(15);
  });

  it("empty string is 0", () => {
    const ext = new ExtRuntime();
    const p = ext.alloc(4);
    writeCString(ext, p, "");
    expect(strlen2(ext.mem, p)).toBe(0);
  });
});
