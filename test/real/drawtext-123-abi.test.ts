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

function call123(ext: ExtRuntime, text: number, x: number, y: number, r: number, g: number, b: number, unicode: number, font: number) {
  const sp = (stackTop() - 16) >>> 0;
  ext.mem.write32(sp, g >>> 0);
  ext.mem.write32((sp + 4) >>> 0, b >>> 0);
  ext.mem.write32((sp + 8) >>> 0, unicode >>> 0);
  ext.mem.write32((sp + 12) >>> 0, font >>> 0);
  return ext.runGuest(tableSlotAddr(123), {
    r0: text,
    r1: x,
    r2: y,
    r3: r,
    sp,
    lr: EXT_STOP_ADDR,
  });
}

describe("table[123] DrawText ABI", () => {
  it("unicode BE text blits generated glyphs and returns 0", () => {
    const { ext, bridge } = wire();
    const text = ext.alloc(8);
    ext.mem.write8(text, 0x00);
    ext.mem.write8((text + 1) >>> 0, 0x41);
    ext.mem.write8((text + 2) >>> 0, 0x00);
    ext.mem.write8((text + 3) >>> 0, 0x00);
    const out = call123(ext, text, 0, 0, 255, 255, 255, 1, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
    expect(bridge.screen.pixels.some((p) => p !== 0)).toBe(true);
  });

  it("NULL text returns 0", () => {
    const { ext } = wire();
    const out = call123(ext, 0, 0, 0, 0, 0, 0, 1, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
  });
});
