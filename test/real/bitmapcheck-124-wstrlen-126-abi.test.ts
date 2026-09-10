import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

describe("table[124] _BitmapCheck ABI", () => {
  it("counts opaque source pixels that are not color_check", () => {
    const { ext, bridge } = wire();
    bridge.screen.pixels[0] = 0x001f;
    bridge.screen.pixels[1] = 0xf800;
    const p = ext.alloc(4);
    ext.mem.write16(p, 0x07e0);
    ext.mem.write16(p + 2, 0x07e0);
    const sp = (stackTop() - 16) >>> 0;
    ext.mem.write32(sp, 1);
    ext.mem.write32(sp + 4, 0);
    ext.mem.write32(sp + 8, 0xf800);
    const out = ext.runGuest(tableSlotAddr(124), {
      r0: p,
      r1: 0,
      r2: 0,
      r3: 2,
      sp,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    // dest[0]=0x001f != 0xf800, dest[1]=0xf800 == check → 1
    expect(out.r0).toBe(1);
  });
});

describe("table[126] wstrlen ABI", () => {
  it("counts UCS-2 bytes until a 0x0000 pair", () => {
    const { ext } = wire();
    const p = ext.alloc(8);
    ext.mem.write8(p, 0x66);
    ext.mem.write8(p + 1, 0x2f);
    ext.mem.write8(p + 2, 0x4e);
    ext.mem.write8(p + 3, 0x00);
    ext.mem.write8(p + 4, 0);
    ext.mem.write8(p + 5, 0);
    const out = ext.runGuest(tableSlotAddr(126), {
      r0: p,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(4);
  });

  it("NULL is 0", () => {
    const { ext } = wire();
    const out = ext.runGuest(tableSlotAddr(126), {
      r0: 0,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
  });
});
