import { describe, expect, it } from "vitest";
import { decodeThumb16 } from "../src/hot/decode-thumb16.ts";
import { step } from "../src/hot/interp.ts";
import { Op, unpackW0 } from "../src/hot/opcodes.ts";
import { makeCpu, putThumb } from "./helpers/cpu.ts";

function dec(hw: number) {
  const out = new Uint32Array(3);
  decodeThumb16(hw, out, 0);
  return { ...unpackW0(out[0]!), w1: out[1]!, w2: out[2]! };
}

function exec(hw: number, regs: number[], cpsr = 0x30) {
  const { cpu, mem } = makeCpu(0x1000, 1);
  putThumb(mem, 0x1000, [hw]);
  cpu.loadRegs(regs);
  cpu.r[15] = 0x1000;
  cpu.cpsr = cpsr;
  step(cpu);
  return cpu;
}

describe("3-D Thumb16", () => {
  it("decodes adds / movs / bx / b", () => {
    expect(dec(0x1c40).op).toBe(Op.ADD);
    expect(dec(0x2001).op).toBe(Op.MOV);
    expect(dec(0x4770).op).toBe(Op.BX);
    expect(dec(0x4770).rm).toBe(14);
    expect(dec(0xe000).op).toBe(Op.B);
  });

  it("adds r0, r0, #1 sets flags", () => {
    const cpu = exec(0x1c40, [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000]);
    expect(cpu.r[0]).toBe(8);
    expect(cpu.z).toBe(0);
    expect(cpu.r[15]).toBe(0x1002);
  });

  it("ADD r0, pc, #0 uses word-aligned PC+4", () => {
    const cpu = exec(0xa000, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000]);
    expect(cpu.r[0]).toBe(0x1004);

    const { cpu: cpu2, mem } = makeCpu(0x1002, 1);
    putThumb(mem, 0x1002, [0xa001]);
    cpu2.r[15] = 0x1002;
    cpu2.cpsr = 0x30;
    step(cpu2);
    expect(cpu2.r[0]).toBe(0x1008);
  });

  it("BX lr switches to ARM when bit0=0", () => {
    const cpu = exec(0x4770, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2000, 0x1000]);
    expect(cpu.t).toBe(0);
    expect(cpu.r[15]).toBe(0x2000);
  });

  it("conditional branch not taken", () => {
    const cpu = exec(0xd000, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000], 0x30);
    expect(cpu.r[15]).toBe(0x1002);
  });

  it("PUSH / POP", () => {
    const { cpu, mem } = makeCpu(0x1000, 1);
    cpu.r[13] = 0x4000;
    cpu.r[1] = 0x12345678;
    cpu.r[14] = 0x2001;
    putThumb(mem, 0x1000, [0xb502]);
    cpu.r[15] = 0x1000;
    cpu.cpsr = 0x30;
    step(cpu);
    expect(cpu.r[13]).toBe(0x3ff8);
    expect(mem.read32(0x3ff8)).toBe(0x12345678);
    expect(mem.read32(0x3ffc)).toBe(0x2001);

    putThumb(mem, 0x1002, [0xbd02]);
    cpu.r[1] = 0;
    cpu.r[15] = 0x1002;
    step(cpu);
    expect(cpu.r[1]).toBe(0x12345678);
    expect(cpu.t).toBe(1);
    expect(cpu.r[15]).toBe(0x2000);
  });
});
