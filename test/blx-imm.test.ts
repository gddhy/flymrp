import { describe, expect, it } from "vitest";
import { decodeArm } from "../src/hot/decode-arm.ts";
import { Op, unpackW0 } from "../src/hot/opcodes.ts";
import { step } from "../src/hot/interp.ts";
import { armBlxImm } from "./helpers/asm.ts";
import { makeCpu, putArm } from "./helpers/cpu.ts";

/**
 * ARM ARM A8.8.26 BLX (immediate), encoding A2:
 *   1111 101 H imm24
 *   imm32 = SignExtend(imm24:H:0)
 *   target = Align(PC,4) + imm32
 *   from ARM: LR = inst+4, CPSR.T = 1 (switch to Thumb)
 * H is an extra offset bit, not a mode flag.
 */
function dec(word: number) {
  const out = new Uint32Array(3);
  decodeArm(word, out, 0);
  return { ...unpackW0(out[0]!), w1: out[1]!, w2: out[2]! };
}

describe("5-C.4 ARM BLX(1) fixture", () => {
  it("0xFA00977C is ARM little-endian BLX(1) H=0", () => {
    const word = 0xfa00977c;
    expect(leBytes(word)).toEqual([0x7c, 0x97, 0x00, 0xfa]);
    const d = dec(word);
    expect(d.op).toBe(Op.BLX);
    expect(d.w2 & 0xff).toBe(1);
    const off = (0x00977c << 2) | 0;
    expect(d.w1 | 0).toBe(off);
    const pc = 0x01e80014;
    expect(((pc + 8 + off) >>> 0)).toBe(0x01ea5e0c);
  });

  it("H=0: T=0 → PC=target T=1 LR=return (ARM)", () => {
    const { cpu, mem } = makeCpu(0x1000, 0);
    putArm(mem, 0x1000, [armBlxImm(2, 0)]);
    cpu.r[15] = 0x1000;
    cpu.t = 0;
    step(cpu);
    expect(cpu.r[15]).toBe(0x1010);
    expect(cpu.r[14]).toBe(0x1004);
    expect(cpu.t).toBe(1);
  });

  it("H=1: extra halfword, still Thumb after", () => {
    const { cpu, mem } = makeCpu(0x1000, 0);
    putArm(mem, 0x1000, [armBlxImm(2, 1)]);
    cpu.r[15] = 0x1000;
    step(cpu);
    expect(cpu.r[15]).toBe(0x1012);
    expect(cpu.r[14]).toBe(0x1004);
    expect(cpu.t).toBe(1);
  });
});

function leBytes(word: number): number[] {
  const w = word >>> 0;
  return [w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff];
}
