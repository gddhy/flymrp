import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge, readGuestCString, strcpy2 } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

describe("table[5] strcpy2 ABI", () => {
  it("copies including NUL and returns dest", () => {
    const { ext } = wire();
    const dst = ext.alloc(16);
    const src = ext.alloc(16);
    writeCString(ext, src, "gssjxz.mrp");
    ext.mem.fill(dst, 0xaa, 16);
    const out = ext.runGuest(tableSlotAddr(5), {
      r0: dst,
      r1: src,
      r2: 0,
      r3: 0,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(dst);
    expect(readGuestCString(ext.mem, dst, 16)).toBe("gssjxz.mrp");
    expect(ext.mem.read8((dst + 10) >>> 0)).toBe(0);
  });

  it("empty src writes a single NUL", () => {
    const { ext } = wire();
    const dst = ext.alloc(4);
    const src = ext.alloc(4);
    writeCString(ext, src, "");
    expect(strcpy2(ext.mem, dst, src)).toBe(dst);
    expect(ext.mem.read8(dst)).toBe(0);
  });
});
