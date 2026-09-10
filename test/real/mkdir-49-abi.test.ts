import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MR_FAILED, MR_IS_DIR, MR_IS_FILE, MR_IS_INVALID, MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MrTableBridge } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire(packName = "gssjxz.mrp") {
  const ext = new ExtRuntime();
  const pack = { name: packName, bytes: new Uint8Array([1, 2, 3, 4]) };
  const bridge = new MrTableBridge(ext, new MythroadVfs(), packName, { getPack: () => pack });
  bridge.install();
  return { ext, bridge };
}

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

function call(ext: ExtRuntime, slot: number, nameAddr: number) {
  return ext.runGuest(tableSlotAddr(slot), { r0: nameAddr, r1: 0, r2: 0, r3: 0, sp: stackTop() - 16, lr: EXT_STOP_ADDR });
}

describe("table[49] mr_mkDir + app-fs info", () => {
  it("creates an in-memory dir; info becomes MR_IS_DIR", () => {
    const { ext, bridge } = wire();
    const p = ext.alloc(16);
    writeCString(ext, p, "gsidbak");
    expect(call(ext, 42, p).r0).toBe(MR_IS_INVALID);
    const out = call(ext, 49, p);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_SUCCESS);
    expect(bridge.lastMkDir).toBe("gsidbak");
    expect(call(ext, 42, p).r0).toBe(MR_IS_DIR);
  });

  it("does not turn archive members or the pack name into dirs", () => {
    const { ext } = wire();
    const pack = ext.alloc(16);
    const res = ext.alloc(16);
    writeCString(ext, pack, "gssjxz.mrp");
    writeCString(ext, res, "res_lang0.rc");
    expect(call(ext, 42, pack).r0).toBe(MR_IS_FILE);
    expect(call(ext, 42, res).r0).toBe(MR_IS_INVALID);
    expect(call(ext, 49, 0).r0).toBe(MR_FAILED >>> 0);
  });

  it("mkdir of an existing dir is MR_SUCCESS", () => {
    const { ext } = wire();
    const p = ext.alloc(16);
    writeCString(ext, p, "gsidbak");
    expect(call(ext, 49, p).r0).toBe(MR_SUCCESS);
    expect(call(ext, 49, p).r0).toBe(MR_SUCCESS);
    expect(call(ext, 42, p).r0).toBe(MR_IS_DIR);
  });
});
