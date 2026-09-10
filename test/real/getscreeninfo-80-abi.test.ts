import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MR_FAILED, MR_SUCCESS, MrTableBridge, MythroadVfs } from "../../src/mythroad/index.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call80(ext: ExtRuntime, r0: number) {
  return ext.runGuest(tableSlotAddr(80), { r0, r1: 0, r2: 0, r3: 0, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
}

describe("table[80] mr_getScreenInfo ABI", () => {
  it("writes 240x320x16 and returns MR_SUCCESS", () => {
    const { ext } = wire();
    const p = ext.alloc(16);
    ext.mem.write32(p, 0xdeadbeef);
    ext.mem.write32(p + 4, 0xdeadbeef);
    ext.mem.write32(p + 8, 0xdeadbeef);
    const out = call80(ext, p);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(ext.mem.read32(p)).toBe(240);
    expect(ext.mem.read32(p + 4)).toBe(320);
    expect(ext.mem.read32(p + 8)).toBe(16);
  });

  it("NULL pointer returns MR_FAILED", () => {
    const { ext, bridge } = wire();
    expect(bridge.getScreenInfo(ext.mem, 0)).toBe(MR_FAILED);
    expect(call80(ext, 0).r0 >>> 0).toBe(0xffffffff);
  });
});
