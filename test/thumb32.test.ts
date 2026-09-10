import { describe, expect, it } from "vitest";
import { decodeThumb32 } from "../src/hot/decode-thumb32.ts";
import { isThumb32Prefix } from "../src/hot/decode-thumb16.ts";
import { step } from "../src/hot/interp.ts";
import { Op, unpackW0 } from "../src/hot/opcodes.ts";
import { makeCpu, putThumb } from "./helpers/cpu.ts";

function dec(hw1: number, hw2: number) {
  const out = new Uint32Array(3);
  decodeThumb32(hw1, hw2, out, 0);
  return { ...unpackW0(out[0]!), w1: out[1]!, w2: out[2]! };
}

describe("3-E Thumb32", () => {
  it("detects 32-bit prefixes", () => {
    expect(isThumb32Prefix(0xf000)).toBe(true);
    expect(isThumb32Prefix(0xf800)).toBe(true);
    expect(isThumb32Prefix(0xe800)).toBe(true);
    expect(isThumb32Prefix(0xe000)).toBe(false);
    expect(isThumb32Prefix(0x2000)).toBe(false);
  });

  it("decodes BL / MOVW / MOVT", () => {
    expect(dec(0xf000, 0xf800).op).toBe(Op.BL);
    const movw = dec(0xf240, 0x00ab);
    expect(movw.op).toBe(Op.MOVW);
    expect(movw.rd).toBe(0);
    expect(movw.w1).toBe(0xab);
    const movt = dec(0xf2c0, 0x0012);
    expect(movt.op).toBe(Op.MOVT);
  });

  it("executes MOVW / MOVT", () => {
    const { cpu, mem } = makeCpu(0x1000, 1);
    putThumb(mem, 0x1000, [0xf240, 0x00ab, 0xf2c0, 0x0012]);
    cpu.cpsr = 0x30;
    step(cpu);
    expect(cpu.r[0]).toBe(0x00ab);
    step(cpu);
    expect(cpu.r[0]).toBe(0x1200ab);
    expect(cpu.r[15]).toBe(0x1008);
  });

  it("BL sets LR with thumb bit and branches", () => {
    const { cpu, mem } = makeCpu(0x1000, 1);
    putThumb(mem, 0x1000, [0xf000, 0xf800]);
    cpu.cpsr = 0x30;
    step(cpu);
    expect(cpu.r[14] & 1).toBe(1);
    expect(cpu.r[14] >>> 1 << 1).toBe(0x1004);
    expect(cpu.r[15]).toBe(0x1004);
    expect(cpu.t).toBe(1);
  });
});
