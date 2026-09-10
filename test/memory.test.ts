import { describe, expect, it } from "vitest";
import { GuestMemory, MemoryFault } from "../src/hot/memory.ts";

describe("3-A GuestMemory", () => {
  it("rejects unaligned constructor args", () => {
    expect(() => new GuestMemory(0x10001, 0x1000)).toThrow(RangeError);
    expect(() => new GuestMemory(0x10000, 3)).toThrow(RangeError);
  });

  it("reads and writes aligned LE 8/16/32 in the primary window", () => {
    const mem = new GuestMemory(0x10000, 0x1000);
    mem.write8(0x10000, 0x11);
    mem.write8(0x10001, 0x22);
    mem.write8(0x10002, 0x33);
    mem.write8(0x10003, 0x44);
    expect(mem.read8(0x10000)).toBe(0x11);
    expect(mem.read16(0x10000)).toBe(0x2211);
    expect(mem.read32(0x10000)).toBe(0x44332211);
    mem.write16(0x10004, 0xaabb);
    expect(mem.read8(0x10004)).toBe(0xbb);
    expect(mem.read8(0x10005)).toBe(0xaa);
    mem.write32(0x10008, 0xdeadbeef);
    expect(mem.slice(0x10008, 4)).toEqual(
      new Uint8Array([0xef, 0xbe, 0xad, 0xde]),
    );
    expect(mem.ram32[0]).toBe(0x44332211);
  });

  it("assembles unaligned 16/32 from bytes without rotate", () => {
    const mem = new GuestMemory(0x10000, 0x1000);
    mem.load(0x10000, [0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(mem.read16(0x10001)).toBe(0x0302);
    expect(mem.read32(0x10001)).toBe(0x05040302);
    mem.write16(0x10001, 0x1122);
    expect(mem.read8(0x10001)).toBe(0x22);
    expect(mem.read8(0x10002)).toBe(0x11);
    mem.write32(0x10001, 0x44556677);
    expect(mem.slice(0x10001, 4)).toEqual(
      new Uint8Array([0x77, 0x66, 0x55, 0x44]),
    );
  });

  it("implements ARMv5 LDR rotate on unaligned word", () => {
    const mem = new GuestMemory(0x10000, 0x1000);
    mem.write32(0x10000, 0x11223344);
    expect(mem.read32Armv5(0x10000)).toBe(0x11223344);
    expect(mem.read32Armv5(0x10001)).toBe(0x44112233);
    expect(mem.read32Armv5(0x10002)).toBe(0x33441122);
    expect(mem.read32Armv5(0x10003)).toBe(0x22334411);
  });

  it("faults on unmapped access and allows a second region", () => {
    const mem = new GuestMemory(0x10000, 0x1000);
    expect(() => mem.read8(0x20000)).toThrow(MemoryFault);
    expect(() => mem.write32(0x0fff, 1)).toThrow(MemoryFault);
    mem.map(0x20000, 0x100);
    mem.write32(0x20000, 0xcafebabe);
    expect(mem.read32(0x20000)).toBe(0xcafebabe);
    expect(() => mem.map(0x10000, 0x100)).toThrow(RangeError);
  });

  it("fill / load / compare", () => {
    const mem = new GuestMemory(0x0, 0x100);
    mem.fill(0x10, 0x5a, 4);
    expect(mem.slice(0x10, 4)).toEqual(new Uint8Array([0x5a, 0x5a, 0x5a, 0x5a]));
    mem.load(0x20, [1, 2, 3]);
    expect(mem.compare(0x20, [1, 2, 3])).toBe(-1);
    expect(mem.compare(0x20, [1, 9, 3])).toBe(1);
  });

  it("inRam / inRamAligned32 match the fast-path contract", () => {
    const mem = new GuestMemory(0x10000, 0x100);
    expect(mem.inRam(0x10000, 4)).toBe(true);
    expect(mem.inRam(0x100fc, 4)).toBe(true);
    expect(mem.inRam(0x100fd, 4)).toBe(false);
    expect(mem.inRamAligned32(0x10004)).toBe(true);
    expect(mem.inRamAligned32(0x10005)).toBe(false);
    expect(mem.inRam(0x20000)).toBe(false);
  });
});
