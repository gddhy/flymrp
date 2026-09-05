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

describe("table[57]/[58] sound ABI", () => {
  it("playSound records guest pointer and returns SUCCESS", () => {
    const { ext, bridge } = wire();
    const out = ext.runGuest(tableSlotAddr(57), {
      r0: 0,
      r1: 0x00201000,
      r2: 128,
      r3: 1,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.lastPlaySound).toEqual({ type: 0, data: 0x00201000, len: 128, loop: 1 });
  });

  it("stopSound uses r0 type and ignores leftover registers", () => {
    const { ext, bridge } = wire();
    const out = ext.runGuest(tableSlotAddr(58), {
      r0: 0,
      r1: 0xdeadbeef,
      r2: 1,
      r3: 2,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.lastStopSound).toEqual({ type: 0 });
  });
});
