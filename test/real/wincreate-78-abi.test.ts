import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MR_IGNORE } from "../../src/mythroad/constants.ts";
import { MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

describe("table[78]/[79] winCreate/winRelease ABI", () => {
  it("rxgj returns MR_IGNORE; no window object", () => {
    const { ext } = wire();
    const c = ext.runGuest(tableSlotAddr(78), { r0: 0, r1: 0, r2: 0, r3: 0, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
    expect(c.kind).toBe(ExtStopKind.Return);
    expect(c.r0).toBe(MR_IGNORE);
    const r = ext.runGuest(tableSlotAddr(79), { r0: 1, r1: 0, r2: 0, r3: 0, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
    expect(r.kind).toBe(ExtStopKind.Return);
    expect(r.r0).toBe(MR_IGNORE);
  });
});
