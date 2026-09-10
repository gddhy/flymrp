import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge, readGuestCString, strcat2 } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

describe("table[7] strcat2 ABI", () => {
  it("appends src including NUL and returns dest", () => {
    const ext = new ExtRuntime();
    new MrTableBridge(ext, new MythroadVfs(), "test").install();
    const dst = ext.alloc(16);
    const src = ext.alloc(8);
    writeCString(ext, dst, "gs");
    writeCString(ext, src, "id");
    const out = ext.runGuest(tableSlotAddr(7), {
      r0: dst,
      r1: src,
      r2: 0,
      r3: 0,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(dst);
    expect(readGuestCString(ext.mem, dst, 16)).toBe("gsid");
  });

  it("empty dest copies src", () => {
    const ext = new ExtRuntime();
    const dst = ext.alloc(8);
    const src = ext.alloc(8);
    writeCString(ext, dst, "");
    writeCString(ext, src, "ab");
    expect(strcat2(ext.mem, dst, src)).toBe(dst);
    expect(readGuestCString(ext.mem, dst, 8)).toBe("ab");
  });
});
