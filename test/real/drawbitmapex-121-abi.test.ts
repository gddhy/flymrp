import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { DRAW_BM_COPY, MR_SUCCESS, MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function writeDesc(ext: ExtRuntime, p: number, bmp: number, w: number, h: number, x: number, y: number): void {
  ext.mem.write32(p, bmp >>> 0);
  ext.mem.write16((p + 4) >>> 0, w & 0xffff);
  ext.mem.write16((p + 6) >>> 0, h & 0xffff);
  ext.mem.write16((p + 8) >>> 0, x & 0xffff);
  ext.mem.write16((p + 10) >>> 0, y & 0xffff);
}

describe("table[121] _DrawBitmapEx ABI", () => {
  it("identity 8.8 transform blits into a guest dest and returns SUCCESS", () => {
    const { ext, bridge } = wire();
    const srcBmp = ext.alloc(8);
    ext.mem.write16(srcBmp, 0xf800);
    ext.mem.write16(srcBmp + 2, 0x07e0);
    ext.mem.write16(srcBmp + 4, 0x001f);
    ext.mem.write16(srcBmp + 6, 0xffff);
    const dstBmp = ext.alloc(16 * 16 * 2);
    const srcDesc = ext.alloc(12);
    const dstDesc = ext.alloc(12);
    const trans = ext.alloc(10);
    writeDesc(ext, srcDesc, srcBmp, 2, 2, 0, 0);
    writeDesc(ext, dstDesc, dstBmp, 16, 16, 6, 6);
    ext.mem.write16(trans, 256);
    ext.mem.write16(trans + 2, 0);
    ext.mem.write16(trans + 4, 0);
    ext.mem.write16(trans + 6, 256);
    ext.mem.write16(trans + 8, DRAW_BM_COPY);
    const sp = (stackTop() - 16) >>> 0;
    ext.mem.write32(sp, trans);
    ext.mem.write32(sp + 4, 0);
    const out = ext.runGuest(tableSlotAddr(121), {
      r0: srcDesc,
      r1: dstDesc,
      r2: 2,
      r3: 2,
      sp,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.lastDrawBitmapEx).toMatchObject({ src: srcDesc, dst: dstDesc, w: 2, h: 2, rop: DRAW_BM_COPY });
    let marked = 0;
    for (let i = 0; i < 16 * 16; i++) {
      const p = ext.mem.read16((dstBmp + i * 2) >>> 0);
      if (p === 0xf800 || p === 0x07e0 || p === 0x001f || p === 0xffff) marked++;
    }
    expect(marked).toBeGreaterThan(0);
  });

  it("zero determinant is a no-op SUCCESS", () => {
    const { ext, bridge } = wire();
    const srcBmp = ext.alloc(2);
    ext.mem.write16(srcBmp, 0xf800);
    const dstBmp = ext.alloc(8);
    const srcDesc = ext.alloc(12);
    const dstDesc = ext.alloc(12);
    const trans = ext.alloc(10);
    writeDesc(ext, srcDesc, srcBmp, 1, 1, 0, 0);
    writeDesc(ext, dstDesc, dstBmp, 2, 2, 0, 0);
    ext.mem.write16(trans, 0);
    ext.mem.write16(trans + 2, 0);
    ext.mem.write16(trans + 4, 0);
    ext.mem.write16(trans + 6, 0);
    ext.mem.write16(trans + 8, DRAW_BM_COPY);
    const sp = (stackTop() - 16) >>> 0;
    ext.mem.write32(sp, trans);
    ext.mem.write32(sp + 4, 0);
    const out = ext.runGuest(tableSlotAddr(121), {
      r0: srcDesc,
      r1: dstDesc,
      r2: 1,
      r3: 1,
      sp,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(ext.mem.read16(dstBmp)).toBe(0);
    expect(bridge.screen.pixels.every((p) => p === 0)).toBe(true);
  });
});
