import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { DRAW_BM_COPY, DRAW_BM_TRANSPARENT, MR_SUCCESS, MrTableBridge, MythroadVfs } from "../../src/mythroad/index.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call120(
  ext: ExtRuntime,
  p: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rop: number,
  trans: number,
  sx: number,
  sy: number,
  mw: number,
) {
  const sp = (stackTop() - 32) >>> 0;
  ext.mem.write32(sp, h >>> 0);
  ext.mem.write32((sp + 4) >>> 0, rop >>> 0);
  ext.mem.write32((sp + 8) >>> 0, trans >>> 0);
  ext.mem.write32((sp + 12) >>> 0, sx >>> 0);
  ext.mem.write32((sp + 16) >>> 0, sy >>> 0);
  ext.mem.write32((sp + 20) >>> 0, mw >>> 0);
  return ext.runGuest(tableSlotAddr(120), {
    r0: p >>> 0,
    r1: x,
    r2: y,
    r3: w,
    sp,
    lr: EXT_STOP_ADDR,
  });
}

describe("table[120] _DrawBitmap ABI", () => {
  it("BM_COPY blits guest RGB565 into the host screen cache", () => {
    const { ext, bridge } = wire();
    const p = ext.alloc(4);
    ext.mem.write16(p, 0x001f);
    ext.mem.write16(p + 2, 0xf800);
    const out = call120(ext, p, 1, 2, 2, 1, DRAW_BM_COPY, 0, 0, 0, 2);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.screen.pixels[2 * 240 + 1]).toBe(0x001f);
    expect(bridge.screen.pixels[2 * 240 + 2]).toBe(0xf800);
    expect(bridge.screen.pixels[2 * 240 + 0]).toBe(0);
  });

  it("BM_TRANSPARENT skips the key color", () => {
    const { ext, bridge } = wire();
    const p = ext.alloc(4);
    ext.mem.write16(p, 0x07e0);
    ext.mem.write16(p + 2, 0xf800);
    const out = call120(ext, p, 0, 0, 2, 1, DRAW_BM_TRANSPARENT, 0x07e0, 0, 0, 2);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.screen.pixels[0]).toBe(0);
    expect(bridge.screen.pixels[1]).toBe(0xf800);
  });

  it("NULL source is a no-op success", () => {
    const { ext, bridge } = wire();
    const out = call120(ext, 0, 0, 0, 2, 2, DRAW_BM_COPY, 0, 0, 0, 2);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.screen.pixels.every((px) => px === 0)).toBe(true);
  });
});
