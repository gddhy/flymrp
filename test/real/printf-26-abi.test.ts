import { describe, expect, it } from "vitest";
import { EXT_STOP_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { UnknownAbiError } from "../../src/err/errors.ts";
import { MrTableBridge, guestPrintf, aapcsPrintfVararg } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

/**
 * rxgj FULL `mr_printf` via table[26].
 * literals + %d + %s + optional width. Return 0.
 */

function wire(): { ext: ExtRuntime; bridge: MrTableBridge } {
  const ext = new ExtRuntime();
  const bridge = new MrTableBridge(ext, new MythroadVfs(), "test");
  bridge.install();
  return { ext, bridge };
}

function writeCString(ext: ExtRuntime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) ext.mem.write8((addr + i) >>> 0, s.charCodeAt(i));
  ext.mem.write8((addr + s.length) >>> 0, 0);
}

function call26(
  ext: ExtRuntime,
  fmt: number,
  r1 = 0,
  r2 = 0,
  r3 = 0,
  stack0 = 0,
) {
  const sp = (stackTop() - 16) >>> 0;
  ext.mem.write32(sp, stack0 >>> 0);
  return ext.runGuest(tableSlotAddr(26), { r0: fmt, r1, r2, r3, sp, lr: EXT_STOP_ADDR });
}

describe("table[26] mr_printf ABI", () => {
  it("returns 0 and records LIVE SDK format", () => {
    const { ext, bridge } = wire();
    const fmt = ext.alloc(32);
    const a = ext.alloc(16);
    const b = ext.alloc(16);
    writeCString(ext, fmt, "SDK%s%dv%d%s)");
    writeCString(ext, a, "v1.0.11.");
    writeCString(ext, b, "CPQA");
    const out = call26(ext, fmt, a, 35, 74, b);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
    expect(bridge.lastPrintf).toBe("SDKv1.0.11.35v74CPQA)");
  });

  it("supports %2d width used by the second LIVE format", () => {
    const { ext, bridge } = wire();
    const fmt = ext.alloc(40);
    const s = ext.alloc(8);
    writeCString(ext, fmt, "SDKv%d.%d.%d.%2d(%dv%d%s)");
    writeCString(ext, s, "u14");
    const out = call26(ext, fmt, 1, 0, 11, 5);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0);
    expect(bridge.lastPrintf.startsWith("SDKv1.0.11.")).toBe(true);
    expect(bridge.lastPrintf.includes(" 5")).toBe(true);
  });

  it("guestPrintf AAPCS first_arg=1 reads R1 then stack", () => {
    const { ext } = wire();
    const fmt = ext.alloc(16);
    const p = ext.alloc(8);
    writeCString(ext, fmt, "%s%d");
    writeCString(ext, p, "x");
    const args = new Uint32Array(8);
    args[0] = fmt;
    args[1] = p;
    args[2] = 9;
    expect(guestPrintf(ext.mem, fmt, (i) => aapcsPrintfVararg(args, i))).toBe("x9");
  });

  it("unknown specifier is UnknownAbiError, not silent drop", () => {
    const { ext } = wire();
    const fmt = ext.alloc(8);
    writeCString(ext, fmt, "%f");
    expect(() => call26(ext, fmt, 1)).toThrow(UnknownAbiError);
  });
});
