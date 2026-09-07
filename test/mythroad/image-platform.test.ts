import { describe, expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

describe("image platform extensions", () => {
  it("returns PNG dimensions through mr_platEx(3001)", () => {
    const ext = new ExtRuntime(), bridge = new MrTableBridge(ext, new MythroadVfs(), "image");
    const input = ext.alloc(12), output = ext.alloc(4), outputLen = ext.alloc(4);
    const png = ext.alloc(24);
    ext.mem.load(png, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,0x49,0x48,0x44,0x52,0,0,0,7,0,0,0,9]);
    ext.mem.write32(input, png); ext.mem.write32(input + 4, 24); ext.mem.write32(input + 8, 1);
    expect(bridge.platEx(ext.mem, new Uint32Array([3001, input, 12, output, outputLen]))).toBe(0);
    const info = ext.mem.read32(output); expect(ext.mem.read32(info)).toBe(7); expect(ext.mem.read32(info + 4)).toBe(9); expect(ext.mem.read32(outputLen)).toBe(8);
  });

  it("accepts already-decoded RGB565 buffers through mr_platEx(3002)", () => {
    const ext = new ExtRuntime(), bridge = new MrTableBridge(ext, new MythroadVfs(), "image");
    const input = ext.alloc(24), source = ext.alloc(4), dest = ext.alloc(4);
    ext.mem.load(source, [0x00,0xf8,0x1f,0x00]);
    [source, 4, 2, 1, 1, dest].forEach((value, i) => ext.mem.write32(input + i * 4, value));
    expect(bridge.platEx(ext.mem, new Uint32Array([3002, input, 24, 0, 0]))).toBe(0);
    expect([...ext.mem.slice(dest, 4)]).toEqual([0x00,0xf8,0x1f,0x00]);
  });
});
