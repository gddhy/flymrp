import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { BYTES_PER_CHAR_16, gb16BitmapSize, gb16Glyph, MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

/**
 * rxgj FULL `mr_getCharBitmap` via table[30].
 * Metrics are CONFIRMED sky16. Glyph pixels are generated.
 */

function wire(): { ext: ExtRuntime; bridge: MrTableBridge } {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call30(ext: ExtRuntime, r0: number, r1: number, r2: number, r3: number) {
  return ext.runGuest(tableSlotAddr(30), { r0, r1, r2, r3, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
}

describe("table[30] mr_getCharBitmap ABI", () => {
  it("ASCII uses 8x16; CJK uses 16x16; slot is reused", () => {
    const { ext, bridge } = wire();
    const w = ext.alloc(4);
    const h = ext.alloc(4);
    const a = call30(ext, 0x32, 0, w, h);
    expect(a.kind).toBe(ExtStopKind.Return);
    expect(ext.mem.read32(w)).toBe(8);
    expect(ext.mem.read32(h)).toBe(16);
    expect(a.r0).toBe(bridge.charBitmapAddr);
    expect(a.r0).toBeGreaterThan(0);

    const b = call30(ext, 0x662f, 1, w, h);
    expect(b.r0).toBe(a.r0);
    expect(ext.mem.read32(w)).toBe(16);
    expect(ext.mem.read32(h)).toBe(16);
  });

  it("null out-pointers skip width/height stores", () => {
    const { ext } = wire();
    const w = ext.alloc(4);
    ext.mem.write32(w, 0xdeadbeef);
    const out = call30(ext, 0x41, 0, 0, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBeGreaterThan(0);
    expect(ext.mem.read32(w)).toBe(0xdeadbeef);
  });

  it("copies packed bitmap_size bytes into the 32-byte slot", () => {
    const { ext } = wire();
    const w = ext.alloc(4);
    const h = ext.alloc(4);
    const out = call30(ext, 0x662f, 0, w, h);
    const g = gb16Glyph(0x662f);
    const n = gb16BitmapSize(g.width, g.height);
    expect(n).toBe(BYTES_PER_CHAR_16);
    expect([...ext.mem.slice(out.r0, n)]).toEqual([...g.bits.subarray(0, n)]);
  });

  it("fontSize does not change metrics without gb12.uc2", () => {
    const { ext } = wire();
    const w = ext.alloc(4);
    const h = ext.alloc(4);
    call30(ext, 0x662f, 0, w, h);
    const small = [ext.mem.read32(w), ext.mem.read32(h)];
    call30(ext, 0x662f, 1, w, h);
    const medium = [ext.mem.read32(w), ext.mem.read32(h)];
    call30(ext, 0x662f, 2, w, h);
    const big = [ext.mem.read32(w), ext.mem.read32(h)];
    expect(small).toEqual([16, 16]);
    expect(medium).toEqual(small);
    expect(big).toEqual(small);
  });
});
