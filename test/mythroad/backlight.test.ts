import { describe, expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";
import { MR_PLAT_VALUE_BASE, MR_SUCCESS } from "../../src/mythroad/constants.ts";

describe("mr_plat backlight compatibility", () => {
  it("reports a lit virtual LCD by default and tracks platEx 1222/1223", () => {
    const ext = new ExtRuntime();
    const bridge = new MrTableBridge(ext, new MythroadVfs(), "backlight");
    expect(bridge.plat(1020, 0)).toBe(MR_PLAT_VALUE_BASE + 1);
    expect(bridge.platEx(ext.mem, new Uint32Array([1223, 0, 0, 0, 0, 0]))).toBe(MR_SUCCESS);
    expect(bridge.plat(1020, 0)).toBe(MR_PLAT_VALUE_BASE);
    expect(bridge.platEx(ext.mem, new Uint32Array([1222, 0, 0, 0, 0, 0]))).toBe(MR_SUCCESS);
    expect(bridge.plat(1020, 0)).toBe(MR_PLAT_VALUE_BASE + 1);
  });
});
