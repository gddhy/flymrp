import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge, strncpy2 } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

describe("table[6] strncpy2 ABI", () => {
  it("copies exactly n bytes and returns dest", () => {
    const ext = new ExtRuntime();
    new MrTableBridge(ext, new MythroadVfs(), "test").install();
    const dst = ext.alloc(8);
    const src = ext.alloc(16);
    writeCString(ext, src, "000000000000000");
    ext.mem.fill(dst, 0xaa, 8);
    const out = ext.runGuest(tableSlotAddr(6), {
      r0: dst,
      r1: src,
      r2: 3,
      r3: 0,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(dst);
    expect([...ext.mem.slice(dst, 8)]).toEqual([0x30, 0x30, 0x30, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
  });

  it("pads with NUL after src ends; count 0 is a no-op", () => {
    const ext = new ExtRuntime();
    const dst = ext.alloc(8);
    const src = ext.alloc(4);
    writeCString(ext, src, "A");
    ext.mem.fill(dst, 0xaa, 8);
    expect(strncpy2(ext.mem, dst, src, 4)).toBe(dst);
    expect([...ext.mem.slice(dst, 8)]).toEqual([0x41, 0, 0, 0, 0xaa, 0xaa, 0xaa, 0xaa]);
    ext.mem.fill(dst, 0xaa, 8);
    expect(strncpy2(ext.mem, dst, src, 0)).toBe(dst);
    expect([...ext.mem.slice(dst, 8)]).toEqual(Array(8).fill(0xaa));
  });
});
