import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadRuntime, NullGraphicsBackend } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

/**
 * This is rxgj FULL compatibility behavior for `uint32 mr_getTime(void)`.
 *
 * mr_getTime is backed by flymrp's deterministic runtime clock.
 * The ARM ABI exposes the low 32 bits as uint32 milliseconds.
 * It does not use JavaScript wall-clock time.
 */

function wire(clock = { ms: 0 }): { ext: ExtRuntime; bridge: MrTableBridge; clock: { ms: number } } {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test", {
    getClock: () => clock.ms,
  });
  bridge.install();
  return { ext, bridge, clock };
}

function call33(ext: ExtRuntime, r0 = 0, r1 = 0, r2 = 0, r3 = 0, stack0 = 0, stack4 = 0) {
  const sp = (stackTop() - 16) >>> 0;
  ext.mem.write32(sp, stack0 >>> 0);
  ext.mem.write32((sp + 4) >>> 0, stack4 >>> 0);
  return ext.runGuest(tableSlotAddr(33), { r0, r1, r2, r3, sp, lr: EXT_STOP_ADDR });
}

describe("5-C.10E table[33] mr_getTime ABI", () => {
  it("uint32 wrap of runtime clock, not signed |0", () => {
    const { ext, bridge, clock } = wire();
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [123456, 123456],
      [0x7fffffff, 0x7fffffff],
      [0x80000000, 0x80000000],
      [0xffffffff, 0xffffffff],
      [0x100000000, 0],
      [0x100000001, 1],
    ];
    for (const [set, want] of cases) {
      clock.ms = set;
      expect(bridge.getTime()).toBe(want);
      const out = call33(ext);
      expect(out.kind).toBe(ExtStopKind.Return);
      expect(out.r0).toBe(want);
      expect(out.r0 >>> 0).toBe(want);
    }
    expect(0x80000000 | 0).toBeLessThan(0);
    expect(0xffffffff | 0).toBe(-1);
    clock.ms = 0x80000000;
    expect(call33(ext).r0).toBe(0x80000000);
    clock.ms = 0xffffffff;
    expect(call33(ext).r0).toBe(0xffffffff);
    expect(call33(ext).r0).not.toBe(0xffffffff | 0);
  });

  it("advance() changes getTime deterministically", () => {
    const rt = new MythroadRuntime({ graphics: new NullGraphicsBackend() });
    expect(rt.clock).toBe(0);
    const ext = new ExtRuntime();
    rt.bindExt(ext);
    expect(rt.mrTable!.getTime()).toBe(0);
    expect(call33(ext).r0).toBe(0);
    rt.advance(10);
    expect(rt.clock).toBe(10);
    expect(call33(ext).r0).toBe(10);
    rt.advance(25);
    expect(rt.clock).toBe(35);
    expect(call33(ext).r0).toBe(35);
  });

  it("incoming R0-R3 and stack do not change the result", () => {
    const { ext, clock } = wire();
    clock.ms = 0x12345678;
    const a = call33(ext, 0x11111111, 0x22222222, 0x33333333, 0x44444444, 0x55555555, 0x66666666);
    const b = call33(ext, 0, 0, 0, 0, 0, 0);
    expect(a.r0).toBe(0x12345678);
    expect(b.r0).toBe(0x12345678);
  });

  it("registers table[33]; source does not use Date.now / performance.now", () => {
    const { ext } = wire();
    expect(!!ext.table.handlers[33]).toBe(true);
    expect(!!ext.table.handlers[38]).toBe(true);
    expect(!!ext.table.handlers[17]).toBe(false);
    const src = [
      readFileSync(resolve(import.meta.dirname, "../../src/mythroad/mr-table.ts"), "utf8"),
      readFileSync(resolve(import.meta.dirname, "../../src/mythroad/runtime.ts"), "utf8"),
    ].join("\n");
    expect(src).not.toMatch(/Date\.now|performance\.now|process\.hrtime|SDL_GetTicks/);
  });
});
