import { describe, expect, it } from "vitest";
import { step } from "../src/hot/interp.ts";
import { CpuTrap } from "../src/hot/cpu.ts";
import {
  OP_ADC,
  OP_ADD,
  OP_CMN,
  OP_CMP,
  OP_MOV,
  OP_SBC,
  OP_SUB,
  OP_TEQ,
  OP_TST,
  armB,
  armBlxImm,
  armBx,
  armDpImm,
  armDpReg,
  armLdrImm,
} from "./helpers/asm.ts";
import { flags, makeCpu, putArm } from "./helpers/cpu.ts";

function exec(word: number, regs: number[], cpsr = 0x10) {
  const { cpu, mem } = makeCpu(0x1000, 0);
  putArm(mem, 0x1000, [word]);
  cpu.loadRegs(regs);
  cpu.r[15] = 0x1000;
  cpu.cpsr = cpsr;
  step(cpu);
  return cpu;
}

describe("3-C ARM interpreter + CPSR", () => {
  it("ADDS 0xffffffff + 1 → Z=1 C=1", () => {
    const cpu = exec(armDpImm(OP_ADD, 1, 1, 0, 1), [0, 0xffffffff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000]);
    expect(cpu.r[0]).toBe(0);
    expect(flags(cpu)).toMatchObject({ n: 0, z: 1, c: 1, v: 0 });
    expect(cpu.r[15]).toBe(0x1004);
  });

  it("SUBS 0 - 1 → N=1 C=0", () => {
    const cpu = exec(
      armDpImm(OP_SUB, 1, 1, 0, 1),
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x20000010,
    );
    expect(cpu.r[0]).toBe(0xffffffff);
    expect(flags(cpu)).toMatchObject({ n: 1, z: 0, c: 0, v: 0 });
  });

  it("ADCS 0xffffffff + 1 + C → 1, C=1", () => {
    const cpu = exec(
      armDpReg(OP_ADC, 1, 1, 0, 2),
      [0, 0xffffffff, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x20000010,
    );
    expect(cpu.r[0]).toBe(1);
    expect(flags(cpu)).toMatchObject({ n: 0, z: 0, c: 1, v: 0 });
  });

  it("SBCS 5 - 3 with C=0 → 1, C=1", () => {
    const cpu = exec(
      armDpReg(OP_SBC, 1, 1, 0, 2),
      [0, 5, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x10,
    );
    expect(cpu.r[0]).toBe(1);
    expect(flags(cpu)).toMatchObject({ n: 0, z: 0, c: 1, v: 0 });
  });

  it("CMP / CMN / TST / TEQ do not write Rd", () => {
    const cmp = exec(
      armDpImm(OP_CMP, 1, 1, 9, 1),
      [0x111, 0, 0, 0, 0, 0, 0, 0, 0, 0x222, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(cmp.r[9]).toBe(0x222);
    expect(cmp.z).toBe(0);
    expect(cmp.c).toBe(0);

    const cmn = exec(
      armDpImm(OP_CMN, 1, 1, 9, 1),
      [0, 0xffffffff, 0, 0, 0, 0, 0, 0, 0, 0x222, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(cmn.r[9]).toBe(0x222);
    expect(cmn.z).toBe(1);
    expect(cmn.c).toBe(1);

    const tst = exec(
      armDpReg(OP_TST, 1, 1, 0, 1),
      [0xabc, 0x80000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(tst.r[0]).toBe(0xabc);
    expect(tst.n).toBe(1);
    expect(tst.z).toBe(0);

    const teq = exec(
      armDpReg(OP_TEQ, 1, 1, 0, 2),
      [0xabc, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(teq.r[0]).toBe(0xabc);
    expect(teq.z).toBe(1);
  });

  it("LSL #0 leaves C; LSR #0 is LSR #32; ASR #0 is ASR #32; ROR #0 is RRX", () => {
    const lsl = exec(
      armDpReg(OP_MOV, 1, 0, 0, 1, 0, 0),
      [0, 0x80000001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x20000010,
    );
    expect(lsl.r[0]).toBe(0x80000001);
    expect(lsl.c).toBe(1);

    const lsr = exec(
      armDpReg(OP_MOV, 1, 0, 0, 1, 1, 0),
      [0, 0x80000001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x10,
    );
    expect(lsr.r[0]).toBe(0);
    expect(lsr.z).toBe(1);
    expect(lsr.c).toBe(1);

    const asr = exec(
      armDpReg(OP_MOV, 1, 0, 0, 1, 2, 0),
      [0, 0x80000001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x10,
    );
    expect(asr.r[0]).toBe(0xffffffff);
    expect(asr.n).toBe(1);
    expect(asr.c).toBe(1);

    const rrx = exec(
      armDpReg(OP_MOV, 1, 0, 0, 1, 3, 0),
      [0, 0x00000002, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x20000010,
    );
    expect(rrx.r[0]).toBe(0x80000001);
    expect(rrx.c).toBe(0);
    expect(rrx.n).toBe(1);
  });

  it("signed overflow V on ADD / SUB", () => {
    const addv = exec(
      armDpReg(OP_ADC, 1, 1, 0, 2),
      [0, 0x7fffffff, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x10,
    );
    expect(addv.r[0]).toBe(0x80000000);
    expect(flags(addv)).toMatchObject({ n: 1, z: 0, c: 0, v: 1 });

    const subv = exec(
      armDpImm(OP_SUB, 1, 1, 0, 1),
      [0, 0x80000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x10,
    );
    expect(subv.r[0]).toBe(0x7fffffff);
    expect(flags(subv)).toMatchObject({ n: 0, z: 0, c: 1, v: 1 });
  });

  it("condition fail skips the write and advances PC", () => {
    const cpu = exec(
      armDpImm(OP_ADD, 0, 1, 0, 1, 0x0),
      [5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
      0x10,
    );
    expect(cpu.r[0]).toBe(5);
    expect(cpu.r[15]).toBe(0x1004);
  });

  it("B / BX / MOV pc", () => {
    const b = exec(armB(0), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000]);
    expect(b.r[15]).toBe(0x1008);

    const bx = exec(
      armBx(1),
      [0, 0x2001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(bx.t).toBe(1);
    expect(bx.r[15]).toBe(0x2000);

    const movpc = exec(
      armDpReg(OP_MOV, 0, 0, 15, 1),
      [0, 0x3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(movpc.r[15]).toBe(0x3000);
    expect(movpc.t).toBe(0);
  });

  it("LDR / STR word LE", () => {
    const { cpu, mem } = makeCpu(0x1000);
    mem.write32(0x2000, 0x11223344);
    putArm(mem, 0x1000, [armLdrImm(1, 0, 0)]);
    cpu.r[0] = 0x2000;
    cpu.r[15] = 0x1000;
    step(cpu);
    expect(cpu.r[1]).toBe(0x11223344);

    putArm(mem, 0x1004, [armLdrImm(2, 0, 0, 0)]);
    cpu.r[15] = 0x1004;
    cpu.r[2] = 0xaabbccdd;
    step(cpu);
    expect(mem.read32(0x2000)).toBe(0xaabbccdd);
  });

  it("reads R15 as PC+8", () => {
    const cpu = exec(
      armDpReg(OP_MOV, 0, 0, 0, 15),
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x1000],
    );
    expect(cpu.r[0]).toBe(0x1008);
  });

  it("SVC traps", () => {
    expect(() => exec(0xef0000ab, new Array(16).fill(0))).toThrow(CpuTrap);
  });

  it("ARM BLX(1) H=0 switches to Thumb and writes LR", () => {
    // PC=0x1000, Align(PC,4)+SignExtend(imm24:H:0)=0x1008+8=0x1010
    const cpu = exec(armBlxImm(2, 0), new Array(16).fill(0));
    expect(cpu.r[15]).toBe(0x1010);
    expect(cpu.r[14]).toBe(0x1004);
    expect(cpu.t).toBe(1);
    expect(cpu.cpsr & 0x20).toBe(0x20);
  });

  it("ARM BLX(1) H=1 uses the extra halfword and stays Thumb", () => {
    const cpu = exec(armBlxImm(2, 1), new Array(16).fill(0));
    expect(cpu.r[15]).toBe(0x1012);
    expect(cpu.r[14]).toBe(0x1004);
    expect(cpu.t).toBe(1);
  });
});
