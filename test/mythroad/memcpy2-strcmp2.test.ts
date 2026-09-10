import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR, EXT_PLATFORM_MEM_ADDR, EXT_STOP_ADDR, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { GuestMemory, MemoryFault } from "../../src/hot/memory.ts";
import { memcpy2, memcmp2, strcmp2, MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";
import { OP_MOV, armBx, armDpReg, armLdrImm, armBlx } from "../helpers/asm.ts";
import { wordsToBytes } from "../helpers/ext-asm.ts";

function wire(ext = new ExtRuntime()): { ext: ExtRuntime; b: MrTableBridge } {
  const b = new MrTableBridge(ext, new MythroadVfs(), "test");
  b.install();
  return { ext, b };
}

function put(mem: GuestMemory, addr: number, bytes: number[]): number {
  mem.load(addr, bytes);
  return addr;
}

function runSlot(
  ext: ExtRuntime,
  slot: number,
  r0: number,
  r1: number,
  r2 = 0,
) {
  const stub = EXT_CODE_ADDR + 0x80;
  ext.pokeCode(
    stub,
    wordsToBytes([
      armDpReg(OP_MOV, 0, 0, 6, 14),
      armLdrImm(4, 15, 4),
      armBlx(4),
      armBx(6),
      tableSlotAddr(slot),
    ]),
  );
  return ext.runGuest(stub, { r0, r1, r2, lr: EXT_STOP_ADDR });
}

describe("5-C.10M table[3] memcpy2", () => {
  it("copies a non-overlapping range and returns original dest", () => {
    const mem = new GuestMemory();
    const src = put(mem, 0x0002_0000, [9, 0, 0, 0, 0xaa]);
    const dst = put(mem, 0x0002_0100, [0xff, 0xff, 0xff, 0xff, 0x11]);
    expect(memcpy2(mem, dst, src, 4)).toBe(dst);
    expect([...mem.slice(dst, 5)]).toEqual([9, 0, 0, 0, 0x11]);
  });

  it("count=0 does not access dest or src and still returns dest", () => {
    const mem = new GuestMemory();
    const dst = 0x0002_0000;
    expect(memcpy2(mem, dst, EXT_PLATFORM_MEM_ADDR, 0)).toBe(dst);
    expect(memcpy2(mem, EXT_PLATFORM_MEM_ADDR, dst, 0)).toBe(EXT_PLATFORM_MEM_ADDR >>> 0);
  });

  it("src==dst is a no-op for content and returns dest", () => {
    const mem = new GuestMemory();
    const p = put(mem, 0x0002_0000, [1, 2, 3, 4]);
    expect(memcpy2(mem, p, p, 4)).toBe(p);
    expect([...mem.slice(p, 4)]).toEqual([1, 2, 3, 4]);
  });

  it("forward overlap dst=src+1 is memcpy2, not memmove", () => {
    const mem = new GuestMemory();
    const base = put(mem, 0x0002_0000, [1, 2, 3, 4, 5]);
    expect(memcpy2(mem, (base + 1) >>> 0, base, 4)).toBe((base + 1) >>> 0);
    expect([...mem.slice(base, 5)]).toEqual([1, 1, 1, 1, 1]);
  });

  it("forward overlap dst<src still copies forward byte-by-byte", () => {
    const mem = new GuestMemory();
    const base = put(mem, 0x0002_0000, [1, 2, 3, 4, 5]);
    expect(memcpy2(mem, base, (base + 1) >>> 0, 4)).toBe(base);
    expect([...mem.slice(base, 5)]).toEqual([2, 3, 4, 5, 5]);
  });

  it("TypedArray.set overlap must not be used as the memcpy2 oracle", () => {
    const host = new Uint8Array([1, 2, 3, 4, 5]);
    const viaSet = new Uint8Array(host);
    viaSet.subarray(1).set(viaSet.subarray(0, 4));
    const mem = new GuestMemory();
    put(mem, 0x0002_0000, [1, 2, 3, 4, 5]);
    memcpy2(mem, 0x0002_0001, 0x0002_0000, 4);
    expect([...mem.slice(0x0002_0000, 5)]).toEqual([1, 1, 1, 1, 1]);
    expect([...viaSet]).toEqual([1, 1, 2, 3, 4]);
    expect([...viaSet]).not.toEqual([1, 1, 1, 1, 1]);
  });

  it("unmapped src / dst with count>0 is MemoryFault, not a guessed return", () => {
    const mem = new GuestMemory();
    const mapped = put(mem, 0x0002_0000, [1, 2, 3, 4]);
    expect(() => memcpy2(mem, mapped, EXT_PLATFORM_MEM_ADDR, 1)).toThrow(MemoryFault);
    expect(() => memcpy2(mem, EXT_PLATFORM_MEM_ADDR, mapped, 1)).toThrow(MemoryFault);
  });

  it("walks off the map on the faulting byte", () => {
    const mem = new GuestMemory();
    const last = (mem.ramBase + mem.ramSize - 1) >>> 0;
    mem.write8(last, 0x5a);
    expect(() => memcpy2(mem, last, last, 2)).toThrow(MemoryFault);
    expect(mem.read8(last)).toBe(0x5a);
  });

  it("guest table[3] returns dest and copies 4 LE bytes", () => {
    const { ext, b } = wire();
    const src = b.malloc(8);
    const dst = b.malloc(8);
    ext.mem.load(src, [9, 0, 0, 0, 0xee]);
    ext.mem.fill(dst, 0xff, 8);
    const out = runSlot(ext, 3, dst, src, 4);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(dst);
    expect([...ext.mem.slice(dst, 5)]).toEqual([9, 0, 0, 0, 0xff]);
  });
});

describe("5-C.10M table[10] strcmp2", () => {
  function z(s: string): number[] {
    return [...s].map((c) => c.charCodeAt(0)).concat(0);
  }

  it("returns exact -1/0/1 on byte strings", () => {
    const mem = new GuestMemory();
    const a = put(mem, 0x0002_0000, z(""));
    const b = put(mem, 0x0002_0100, z(""));
    const aa = put(mem, 0x0002_0200, z("a"));
    const bb = put(mem, 0x0002_0300, z("b"));
    const aaa = put(mem, 0x0002_0400, z("aa"));
    const abc = put(mem, 0x0002_0500, z("abc"));
    const abd = put(mem, 0x0002_0600, z("abd"));
    expect(strcmp2(mem, a, b)).toBe(0);
    expect(strcmp2(mem, aa, aa)).toBe(0);
    expect(strcmp2(mem, aa, bb)).toBe(-1);
    expect(strcmp2(mem, bb, aa)).toBe(1);
    expect(strcmp2(mem, aa, aaa)).toBe(-1);
    expect(strcmp2(mem, aaa, aa)).toBe(1);
    expect(strcmp2(mem, abc, abd)).toBe(-1);
  });

  it("compares unsigned char so 0x80 > 0x7f", () => {
    const mem = new GuestMemory();
    const lo = put(mem, 0x0002_0000, [0x7f, 0]);
    const hi = put(mem, 0x0002_0100, [0x80, 0]);
    expect(strcmp2(mem, lo, hi)).toBe(-1);
    expect(strcmp2(mem, hi, lo)).toBe(1);
  });

  it("does not read past the first differing byte", () => {
    const mem = new GuestMemory();
    const left = put(mem, 0x0002_0000, [0x61, 0]);
    const last = (mem.ramBase + mem.ramSize - 1) >>> 0;
    mem.write8(last, 0x62);
    expect(strcmp2(mem, left, last)).toBe(-1);
  });

  it("unmapped pointer is MemoryFault, not a silent empty string", () => {
    const mem = new GuestMemory();
    const mapped = put(mem, 0x0002_0000, [0]);
    expect(() => strcmp2(mem, EXT_PLATFORM_MEM_ADDR, mapped)).toThrow(MemoryFault);
    expect(() => strcmp2(mem, mapped, EXT_PLATFORM_MEM_ADDR)).toThrow(MemoryFault);
  });

  it("guest table[10] writes -1 as 0xffffffff", () => {
    const { ext, b } = wire();
    const cs = b.malloc(4);
    const ct = b.malloc(4);
    ext.mem.load(cs, [0x61, 0]);
    ext.mem.load(ct, [0x62, 0]);
    const out = runSlot(ext, 10, cs, ct, 0);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0xffffffff);
    ext.mem.load(ct, [0x61, 0]);
    const eq = runSlot(ext, 10, cs, ct, 0);
    expect(eq.r0).toBe(0);
  });

  it("registers memmove alongside the existing memory helpers", () => {
    const { ext } = wire();
    expect(ext.table.handlers[1]).toBeTruthy();
    expect(ext.table.handlers[3]).toBeTruthy();
    expect(ext.table.handlers[9]).toBeTruthy();
    expect(ext.table.handlers[10]).toBeTruthy();
    expect(ext.table.handlers[4]).toBeTruthy();
  });
});

describe("5-C.10P table[9] memcmp2", () => {
  it("equal bytes return 0 for n=0/1/2/multi", () => {
    const mem = new GuestMemory();
    const a = put(mem, 0x0002_0000, [0x1f, 0x8b, 0x08, 0x00]);
    const b = put(mem, 0x0002_0100, [0x1f, 0x8b, 0x08, 0x00]);
    expect(memcmp2(mem, a, b, 0)).toBe(0);
    expect(memcmp2(mem, a, b, 1)).toBe(0);
    expect(memcmp2(mem, a, b, 2)).toBe(0);
    expect(memcmp2(mem, a, b, 4)).toBe(0);
  });

  it("returns exact unsigned-char difference, not -1/0/1", () => {
    const mem = new GuestMemory();
    const a = put(mem, 0x0002_0000, [0x00, 0x7f, 0x80, 0xff]);
    const b = put(mem, 0x0002_0100, [0xff, 0x80, 0x7f, 0x00]);
    expect(memcmp2(mem, a, b, 1)).toBe(0x00 - 0xff);
    expect(memcmp2(mem, (a + 1) >>> 0, (b + 1) >>> 0, 1)).toBe(0x7f - 0x80);
    expect(memcmp2(mem, (a + 2) >>> 0, (b + 2) >>> 0, 1)).toBe(0x80 - 0x7f);
    expect(memcmp2(mem, (a + 3) >>> 0, (b + 3) >>> 0, 1)).toBe(0xff - 0x00);
    expect(memcmp2(mem, a, b, 1)).not.toBe(-1);
    expect(memcmp2(mem, (a + 3) >>> 0, (b + 3) >>> 0, 1)).not.toBe(1);
  });

  it("count=0 does not access unmapped pointers", () => {
    const mem = new GuestMemory();
    expect(memcmp2(mem, EXT_PLATFORM_MEM_ADDR, EXT_PLATFORM_MEM_ADDR, 0)).toBe(0);
    expect(memcmp2(mem, 0, EXT_PLATFORM_MEM_ADDR, 0)).toBe(0);
  });

  it("early-exits on first difference and does not touch later unmapped bytes", () => {
    const mem = new GuestMemory();
    const last = (mem.ramBase + mem.ramSize - 1) >>> 0;
    mem.write8(last, 0xaa);
    const other = put(mem, 0x0002_0000, [0xbb, 0]);
    expect(memcmp2(mem, last, other, 2)).toBe(0xaa - 0xbb);
  });

  it("unmapped pointer with n>0 is MemoryFault", () => {
    const mem = new GuestMemory();
    const mapped = put(mem, 0x0002_0000, [1, 2]);
    expect(() => memcmp2(mem, EXT_PLATFORM_MEM_ADDR, mapped, 1)).toThrow(MemoryFault);
    expect(() => memcmp2(mem, mapped, EXT_PLATFORM_MEM_ADDR, 1)).toThrow(MemoryFault);
  });

  it("guest table[9] writes the signed difference into R0", () => {
    const { ext, b } = wire();
    const s1 = b.malloc(4);
    const s2 = b.malloc(4);
    ext.mem.load(s1, [0x1f, 0x8b]);
    ext.mem.load(s2, [0x1f, 0x8b]);
    const eq = runSlot(ext, 9, s1, s2, 2);
    expect(eq.kind).toBe(ExtStopKind.Return);
    expect(eq.r0).toBe(0);
    ext.mem.load(s2, [0x1f, 0x00]);
    const ne = runSlot(ext, 9, s1, s2, 2);
    expect(ne.r0).toBe(0x8b);
  });
});
