import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { makeRgb565, MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call122(
  ext: ExtRuntime,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
) {
  const sp = (stackTop() - 16) >>> 0;
  ext.mem.write32(sp, r >>> 0);
  ext.mem.write32((sp + 4) >>> 0, g >>> 0);
  ext.mem.write32((sp + 8) >>> 0, b >>> 0);
  return ext.runGuest(tableSlotAddr(122), {
    r0: x,
    r1: y,
    r2: w,
    r3: h,
    sp,
    lr: EXT_STOP_ADDR,
  });
}

describe("table[122] DrawRect ABI", () => {
  it("LIVE zero-size black rect is MR_SUCCESS and does not write pixels", () => {
    const { ext, bridge } = wire();
    const out = call122(ext, 0, 0, 0, 0, 0, 0, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.screen.pixels.every((p) => p === 0)).toBe(true);
  });

  it("clips and fills RGB565", () => {
    const { ext, bridge } = wire();
    const out = call122(ext, 2, 3, 2, 1, 255, 0, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    const red = makeRgb565(255, 0, 0);
    expect(bridge.screen.pixels[3 * 240 + 2]).toBe(red);
    expect(bridge.screen.pixels[3 * 240 + 3]).toBe(red);
    expect(bridge.screen.pixels[3 * 240 + 1]).toBe(0);
    expect(bridge.screen.pixels[2 * 240 + 2]).toBe(0);
  });
});
