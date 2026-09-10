import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MR_NET_ID_MOBILE } from "../../src/mythroad/constants.ts";
import { MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

describe("table[61] mr_getNetworkID ABI", () => {
  it("returns MR_NET_ID_MOBILE and ignores registers", () => {
    const ext = new ExtRuntime();
    new MrTableBridge(ext, new MythroadVfs(), "test").install();
    const out = ext.runGuest(tableSlotAddr(61), {
      r0: 0x000100f4,
      r1: 0x0001008c,
      r2: 0,
      r3: 1,
      sp: stackTop() - 16,
      lr: EXT_STOP_ADDR,
    });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_NET_ID_MOBILE);
  });
});
