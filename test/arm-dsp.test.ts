import { describe, expect, it } from "vitest";
import { step } from "../src/hot/interp.ts";
import { makeCpu, putArm } from "./helpers/cpu.ts";
import vectors from "./fixtures/cpu/arm-dsp.json";

describe("ARMv5TE DSP multiplication", () => {
  it("executes Transformers' SMULBB r1,r2,r1 with signed low halves", () => {
    const { cpu, mem } = makeCpu(0x1000, 0);
    putArm(mem, 0x1000, [0xe1610182]);
    cpu.r[1] = 0x1234fffe;
    cpu.r[2] = 0xabcd8000;
    cpu.cpsr = 0xf8000010;
    step(cpu);
    expect(cpu.r[1]).toBe(65536);
    expect(cpu.cpsr).toBe(0xf8000010);
    expect(cpu.r[15]).toBe(0x1004);
  });
  it("matches independent Unicorn vectors for all 16 encodings, half selection, rounding, carry and sticky Q", () => {
    for (const v of vectors.cases) {
      const { cpu, mem } = makeCpu(0x1000, 0);
      putArm(mem, 0x1000, [v.word]);
      v.before.forEach((value, i) => cpu.r[i] = value);
      cpu.cpsr = v.cpsr;
      step(cpu);
      expect([...cpu.r.slice(0, 5)], v.word.toString(16)).toEqual(v.after);
      expect(cpu.cpsr, v.word.toString(16)).toBe(v.afterCpsr);
    }
  });
  it("skips conditional DSP instructions and permits MSR to clear Q", () => {
    const { cpu, mem } = makeCpu(0x1000, 0);
    putArm(mem, 0x1000, [0x01610182, 0xe128f000]);
    cpu.r[1] = 7;
    cpu.r[2] = 9;
    cpu.cpsr = 0x08000010;
    step(cpu);
    expect(cpu.r[1]).toBe(7);
    expect(cpu.cpsr & 0x08000000).toBeTruthy();
    step(cpu);
    expect(cpu.cpsr & 0x08000000).toBe(0);
  });
});
