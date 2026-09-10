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

describe("table[145] mr_platDrawChar ABI", () => {
  it("blits a generated glyph with RGB565 color and returns 0", () => {
    const { ext, bridge } = wire();
    const out = ext.runGuest(tableSlotAddr(145), {
      r0: 0x41,
      r1: 4,
      r2: 8,
      r3: 0xffff,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
    expect(bridge.lastPlatDrawChar).toEqual({ ch: 0x41, x: 4, y: 8, color: 0xffff });
    expect(bridge.screen.pixels.some((p) => p !== 0)).toBe(true);
  });

  it("NULL-looking leftover stack is ignored", () => {
    const { ext, bridge } = wire();
    const out = ext.runGuest(tableSlotAddr(145), {
      r0: 0x662f,
      r1: 0,
      r2: 0,
      r3: 0xf800,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
    expect(bridge.lastPlatDrawChar?.ch).toBe(0x662f);
    expect(bridge.lastPlatDrawChar?.color).toBe(0xf800);
    expect(bridge.screen.pixels.some((p) => p === 0xf800)).toBe(true);
  });
});
