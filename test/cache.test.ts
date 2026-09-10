import { describe, expect, it } from "vitest";
import { BlockCache } from "../src/hot/cache.ts";
import { run } from "../src/hot/interp.ts";
import { armDpImm, OP_ADD } from "./helpers/asm.ts";
import { makeCpu, putArm, putThumb } from "./helpers/cpu.ts";

describe("3-F BlockCache T-state keys", () => {
  it("does not reuse an ARM block for Thumb at the same address", () => {
    const { cpu, mem } = makeCpu(0x1000, 0);
    putArm(mem, 0x1000, [armDpImm(OP_ADD, 0, 0, 0, 1), armDpImm(OP_ADD, 0, 0, 0, 1)]);
    putThumb(mem, 0x2000, [0x1c40, 0x1c40]);
    const cache = new BlockCache();
    cache.addRegion(0, 0x1_0000);
    cpu.cache = cache;

    cpu.t = 0;
    cpu.r[0] = 0;
    cpu.r[15] = 0x1000;
    run(cpu, 2);
    const armId = cache.lookupId(0x1000, 0);
    expect(armId).toBeGreaterThan(0);
    expect(cache.lookupId(0x1000, 1)).toBe(0);

    cpu.reset(0x1000, 1);
    cpu.cache = cache;
    putThumb(mem, 0x1000, [0x2005]);
    run(cpu, 1);
    const thumbId = cache.lookupId(0x1000, 1);
    expect(thumbId).toBeGreaterThan(0);
    expect(thumbId).not.toBe(armId);
    expect(cache.pool[armId]!.thumb).toBe(0);
    expect(cache.pool[thumbId]!.thumb).toBe(1);
  });

  it("indexes Thumb at halfword granularity", () => {
    const { cpu, mem } = makeCpu(0x1000, 1);
    putThumb(mem, 0x1000, [0x2001, 0x2002]);
    const cache = new BlockCache();
    cache.addRegion(0, 0x2000);
    cpu.cache = cache;
    cpu.cpsr = 0x30;
    run(cpu, 1);
    expect(cache.lookupId(0x1000, 1)).toBeGreaterThan(0);
    expect(cache.lookupId(0x1002, 1)).toBe(0);
    cpu.r[15] = 0x1002;
    run(cpu, 1);
    expect(cache.lookupId(0x1002, 1)).toBeGreaterThan(0);
    expect(cache.lookupId(0x1002, 1)).not.toBe(cache.lookupId(0x1000, 1));
  });

  it("findRegion uses unsigned address distance", () => {
    const cache = new BlockCache();
    cache.addRegion(0x01e8_0000, 8);
    cache.addRegion(0x0020_8000, 8);
    expect(cache.findRegion(0x0020_8000)?.base).toBe(0x0020_8000);
    expect(cache.findRegion(0x01e8_0000)?.base).toBe(0x01e8_0000);
    expect(cache.findRegion(0x0020_0000)).toBeNull();
  });

  it("invalidate clears both ARM and Thumb tables", () => {
    const { cpu, mem } = makeCpu(0x1000, 0);
    putArm(mem, 0x1000, [armDpImm(OP_ADD, 0, 0, 0, 1)]);
    const cache = new BlockCache();
    cache.addRegion(0, 0x2000);
    cpu.cache = cache;
    run(cpu, 1);
    expect(cache.lookupId(0x1000, 0)).toBeGreaterThan(0);
    cache.invalidate(0x1000, 4);
    expect(cache.lookupId(0x1000, 0)).toBe(0);
  });
});
