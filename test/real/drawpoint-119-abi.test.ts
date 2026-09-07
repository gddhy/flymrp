import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

describe("table[119] _DrawPoint ABI", () => {
  it("writes one RGB565 pixel and returns SUCCESS", () => {
    const { ext, bridge } = wire();
    const out = ext.runGuest(tableSlotAddr(119), {
      r0: 10,
      r1: 20,
      r2: 0xf800,
      r3: 0xdeadbeef,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.lastDrawPoint).toEqual({ x: 10, y: 20, color: 0xf800 });
    expect(bridge.screen.pixels[20 * bridge.screen.width + 10]).toBe(0xf800);
  });

  it("clips out-of-bounds and still returns SUCCESS", () => {
    const { ext, bridge } = wire();
    const out = ext.runGuest(tableSlotAddr(119), {
      r0: -1,
      r1: 400,
      r2: 0x07e0,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.lastDrawPoint).toEqual({ x: -1, y: 400, color: 0x07e0 });
    expect(bridge.screen.pixels.every((p) => p === 0)).toBe(true);
  });
});
