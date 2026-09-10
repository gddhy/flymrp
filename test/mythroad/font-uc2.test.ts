import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import {
  BYTES_PER_CHAR_16,
  GB16_UC2_SIZE,
  gb16Glyph,
  gb16Uc2Loaded,
  gbkBytesToUcs2,
  loadGb16Uc2,
  MrTableBridge,
  unloadGb16Uc2,
} from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

const UC2 = resolve(import.meta.dirname, "../../assets/system/gb16.uc2");

describe("gb16.uc2 platform font", () => {
  it("indexes UCS-2 glyphs; GBK text maps to Unicode first", () => {
    expect(existsSync(UC2)).toBe(true);
    const bytes = new Uint8Array(readFileSync(UC2));
    expect(bytes.length).toBe(GB16_UC2_SIZE);
    loadGb16Uc2(bytes);
    try {
      expect(gb16Uc2Loaded()).toBe(true);
      expect(gbkBytesToUcs2(new Uint8Array([0xbf, 0xaa, 0xc6, 0xf4]))).toEqual([0x5f00, 0x542f]);

      const shi = gb16Glyph(0x662f);
      expect(shi.width).toBe(16);
      expect(shi.height).toBe(16);
      expect(shi.bits.length).toBe(BYTES_PER_CHAR_16);
      expect(shi.bits.some((b) => b !== 0)).toBe(true);
      expect(shi.bits[0]).not.toBe(0xff);
      expect(shi.bits[1]).not.toBe(0xff);

      const a = gb16Glyph(0x41);
      expect(a.width).toBe(8);
      expect(a.bits.some((b) => b !== 0)).toBe(true);

      const ext = new ExtRuntime();
      const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
      bridge.install();
      const text = ext.alloc(8);
      ext.mem.write8(text, 0x66);
      ext.mem.write8((text + 1) >>> 0, 0x2f);
      ext.mem.write8((text + 2) >>> 0, 0x00);
      ext.mem.write8((text + 3) >>> 0, 0x00);
      const sp = (stackTop() - 16) >>> 0;
      ext.mem.write32(sp, 255);
      ext.mem.write32((sp + 4) >>> 0, 255);
      ext.mem.write32((sp + 8) >>> 0, 1);
      ext.mem.write32((sp + 12) >>> 0, 0);
      const out = ext.runGuest(tableSlotAddr(123), {
        r0: text,
        r1: 0,
        r2: 0,
        r3: 255,
        sp,
        lr: EXT_STOP_ADDR,
      });
      expect(out.kind).toBe(ExtStopKind.Return);
      expect(out.r0).toBe(0);
      expect(bridge.screen.pixels.some((p) => p !== 0)).toBe(true);
    } finally {
      unloadGb16Uc2();
    }
    expect(gb16Uc2Loaded()).toBe(false);
  });
});
