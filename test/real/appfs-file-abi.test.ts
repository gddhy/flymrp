import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import {
  MR_FILE_CREATE,
  MR_FILE_RDONLY,
  MR_FILE_RDWR,
  MR_IS_DIR,
  MR_IS_FILE,
  MrTableBridge,
} from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

function wire() {
  const ext = new ExtRuntime();
  const pack = { name: "gssjxz.mrp", bytes: new Uint8Array([1, 2, 3, 4]) };
  const bridge = new MrTableBridge(ext, new MythroadVfs(), pack.name, { getPack: () => pack });
  bridge.install();
  return { ext, bridge };
}

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

function putName(ext: ExtRuntime, s: string): number {
  const p = ext.alloc(s.length + 1);
  writeCString(ext, p, s);
  return p;
}

function call(ext: ExtRuntime, slot: number, r0: number, r1 = 0, r2 = 0) {
  return ext.runGuest(tableSlotAddr(slot), { r0, r1, r2, lr: EXT_STOP_ADDR });
}

describe("AppFS EFS file ABI", () => {
  it("missing RDONLY returns 0; CREATE|RDWR creates gssjxz\\69 and write persists", () => {
    const { ext, bridge } = wire();
    const name = putName(ext, "gssjxz\\69");
    expect(call(ext, 40, name, MR_FILE_RDONLY).r0).toBe(0);
    const created = call(ext, 40, name, MR_FILE_RDWR | MR_FILE_CREATE);
    expect(created.kind).toBe(ExtStopKind.Return);
    expect(created.r0).toBe(1);
    expect(bridge.appFs.info("gssjxz")).toBe(MR_IS_DIR);
    expect(bridge.appFs.info("gssjxz/69")).toBe(MR_IS_FILE);
    expect(bridge.appFs.info("gssjxz\\69")).toBe(MR_IS_FILE);

    const src = ext.alloc(4);
    ext.mem.write8(src, 0xaa);
    ext.mem.write8(src + 1, 0xbb);
    expect(call(ext, 43, 1, src, 2).r0).toBe(2);
    expect(call(ext, 41, 1).r0).toBe(0);

    expect(call(ext, 40, name, MR_FILE_RDONLY).r0).toBe(2);
    const dst = ext.alloc(4);
    expect(call(ext, 44, 2, dst, 2).r0).toBe(2);
    expect(ext.mem.read8(dst)).toBe(0xaa);
    expect(ext.mem.read8(dst + 1)).toBe(0xbb);
  });

  it("does not serve archive members or the pack bytes through EFS", () => {
    const { ext, bridge } = wire();
    const member = putName(ext, "69.bmp");
    expect(call(ext, 40, member, MR_FILE_RDONLY).r0).toBe(0);
    expect(bridge.appFs.file("69.bmp")).toBeNull();
    const pack = putName(ext, "gssjxz.mrp");
    expect(call(ext, 40, pack, MR_FILE_RDONLY).r0).toBe(1);
    expect(bridge.files.peek(1)?.writable).toBe(false);
  });
});
