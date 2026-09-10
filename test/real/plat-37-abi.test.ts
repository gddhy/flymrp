import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { UnknownAbiError } from "../../src/err/errors.ts";
import { MR_CHECK_TOUCH, MR_CHINESE, MR_GET_HANDSET_LG, MR_TOUCH_SCREEN } from "../../src/mythroad/constants.ts";
import { MR_PLAT_CHECK_TOUCH, MR_PLAT_GET_HANDSET_LG, MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

/**
 * rxgj FULL `mr_plat(MR_GET_HANDSET_LG, 0)` via table[37].
 * Not the complete `mr_plat` API.
 */

function wire(): { ext: ExtRuntime; bridge: MrTableBridge } {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function call37(ext: ExtRuntime, r0: number, r1 = 0) {
  return ext.runGuest(tableSlotAddr(37), { r0, r1, r2: 0, r3: 0, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
}

describe("table[37] mr_plat ABI", () => {
  it("LIVE code 1206 returns MR_CHINESE 1000", () => {
    expect(MR_GET_HANDSET_LG).toBe(1206);
    expect(MR_PLAT_GET_HANDSET_LG).toBe(1206);
    expect(MR_CHINESE).toBe(1000);
    const { ext } = wire();
    const out = call37(ext, MR_GET_HANDSET_LG, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_CHINESE);
  });

  it("LIVE code 1205 returns MR_TOUCH_SCREEN 1001 (rxgj FULL)", () => {
    expect(MR_CHECK_TOUCH).toBe(1205);
    expect(MR_PLAT_CHECK_TOUCH).toBe(1205);
    expect(MR_TOUCH_SCREEN).toBe(1001);
    const { ext, bridge } = wire();
    expect(bridge.plat(MR_CHECK_TOUCH, 0)).toBe(MR_TOUCH_SCREEN);
    const out = call37(ext, MR_CHECK_TOUCH, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_TOUCH_SCREEN);
  });

  it("param is ignored for 1206", () => {
    const { ext, bridge } = wire();
    expect(bridge.plat(MR_GET_HANDSET_LG, 0x1234)).toBe(MR_CHINESE);
    expect(call37(ext, MR_GET_HANDSET_LG, 0xffffffff).r0).toBe(MR_CHINESE);
  });

  it("unknown plat code is UnknownAbiError, not 0", () => {
    const { ext } = wire();
    expect(() => call37(ext, 1, 0)).toThrow(UnknownAbiError);
  });
});
