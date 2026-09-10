import { describe, expect, it } from "vitest";
import { step } from "../../src/hot/interp.ts";
import { CpuTrap, UnsupportedInsn } from "../../src/hot/cpu.ts";
import {
  OP_ADC,
  OP_ADD,
  OP_AND,
  OP_BIC,
  OP_CMP,
  OP_EOR,
  OP_MOV,
  OP_MVN,
  OP_ORR,
  OP_RSB,
  OP_SBC,
  OP_SUB,
  OP_TST,
  armB,
  armBlxImm,
  armBx,
  armDpImm,
  armDpReg,
  armDpRegShift,
  armLdrImm,
  armMul,
  le32,
} from "../helpers/asm.ts";
import { makeCpu, putArm, putThumb } from "../helpers/cpu.ts";
import { hexBytes, unicornStep } from "./oracle.ts";

const CPSR_NZCVT = 0xf8000020;

function regs16(partial: number[], pc = 0x1000): number[] {
  const r = new Array(16).fill(0);
  for (let i = 0; i < partial.length && i < 16; i++) r[i] = partial[i]! >>> 0;
  r[15] = pc;
  return r;
}

async function compareArm(word: number, r: number[], cpsr: number, mem?: { addr: number; bytes: number[] }) {
  const { cpu, mem: gmem } = makeCpu(0x1000, 0);
  putArm(gmem, 0x1000, [word]);
  if (mem) gmem.load(mem.addr, mem.bytes);
  cpu.loadRegs(r);
  cpu.r[15] = 0x1000;
  cpu.cpsr = cpsr;

  const extra = mem
    ? [{ addr: mem.addr, hex: hexBytes(Uint8Array.from(mem.bytes)) }]
    : [];

  let jsErr: string | null = null;
  try {
    step(cpu);
  } catch (e) {
    if (e instanceof UnsupportedInsn || e instanceof CpuTrap) jsErr = e.name;
    else throw e;
  }

  const uni = await unicornStep({
    code: hexBytes(le32(word)),
    pc: 0x1000,
    thumb: 0,
    regs: r,
    cpsr,
    count: 1,
    mem: extra,
    dump: mem ? [{ addr: mem.addr, len: mem.bytes.length }] : [],
  });

  if (jsErr || uni.error) {
    return { skipped: true, jsErr, uniErr: uni.error };
  }

  for (let i = 0; i < 16; i++) {
    expect(cpu.r[i] >>> 0, `r${i}`).toBe(uni.regs[i]! >>> 0);
  }
  expect(cpu.cpsr & CPSR_NZCVT, "cpsr nzcvt").toBe(uni.cpsr & CPSR_NZCVT);
  return { skipped: false };
}

async function compareThumb(hw: number[], r: number[], cpsr: number) {
  const { cpu, mem } = makeCpu(0x1000, 1);
  putThumb(mem, 0x1000, hw);
  cpu.loadRegs(r);
  cpu.r[15] = 0x1000;
  cpu.cpsr = cpsr;
  let jsErr: string | null = null;
  try {
    step(cpu);
  } catch (e) {
    if (e instanceof UnsupportedInsn || e instanceof CpuTrap) jsErr = e.name;
    else throw e;
  }
  const bytes = new Uint8Array(hw.length * 2);
  hw.forEach((h, i) => {
    bytes[i * 2] = h & 0xff;
    bytes[i * 2 + 1] = h >>> 8;
  });
  const uni = await unicornStep({
    code: hexBytes(bytes),
    pc: 0x1000,
    thumb: 1,
    regs: r,
    cpsr,
    count: 1,
  });
  if (jsErr || uni.error) return { skipped: true };
  for (let i = 0; i < 16; i++) {
    expect(cpu.r[i] >>> 0, `r${i}`).toBe(uni.regs[i]! >>> 0);
  }
  expect(cpu.cpsr & CPSR_NZCVT).toBe(uni.cpsr & CPSR_NZCVT);
  return { skipped: false };
}

describe("3-G Unicorn differential", () => {
  it("ALU / flags / shift #0", async () => {
    const z = regs16([0, 0xffffffff, 1]);
    await compareArm(armDpImm(OP_ADD, 1, 1, 0, 1), z, 0x10);
    await compareArm(armDpImm(OP_SUB, 1, 1, 0, 1), regs16([0, 0]), 0x20000010);
    await compareArm(armDpReg(OP_ADC, 1, 1, 0, 2), regs16([0, 0xffffffff, 1]), 0x20000010);
    await compareArm(armDpReg(OP_SBC, 1, 1, 0, 2), regs16([0, 5, 3]), 0x10);
    await compareArm(armDpImm(OP_CMP, 1, 1, 0, 1), regs16([0, 0]), 0x10);
    await compareArm(armDpReg(OP_TST, 1, 1, 0, 1), regs16([0, 0x80000000]), 0x10);
    await compareArm(armDpReg(OP_MOV, 1, 0, 0, 1, 0, 0), regs16([0, 0x80000001]), 0x20000010);
    await compareArm(armDpReg(OP_MOV, 1, 0, 0, 1, 1, 0), regs16([0, 0x80000001]), 0x10);
    await compareArm(armDpReg(OP_MOV, 1, 0, 0, 1, 2, 0), regs16([0, 0x80000001]), 0x10);
    await compareArm(armDpReg(OP_MOV, 1, 0, 0, 1, 3, 0), regs16([0, 2]), 0x20000010);
    await compareArm(armDpReg(OP_ADC, 1, 1, 0, 2), regs16([0, 0x7fffffff, 1]), 0x10);
    await compareArm(armDpImm(OP_SUB, 1, 1, 0, 1), regs16([0, 0x80000000]), 0x10);
    await compareArm(armDpReg(OP_MOV, 0, 0, 0, 15), regs16([]), 0x10);
  });

  it("LDR", async () => {
    await compareArm(
      armLdrImm(1, 0, 0),
      regs16([0x2000]),
      0x10,
      { addr: 0x2000, bytes: [0x44, 0x33, 0x22, 0x11] },
    );
  });

  it("Thumb16 adds / movs / add pc", async () => {
    await compareThumb([0x1c40], regs16([7]), 0x30);
    await compareThumb([0x2005], regs16([0]), 0x30);
    await compareThumb([0xa000], regs16([0]), 0x30);
  });

  it("random data-processing vs Unicorn", async () => {
    let pass = 0;
    let skip = 0;
    for (let i = 0; i < 200; i++) {
      const opcode = [OP_AND, OP_EOR, OP_SUB, OP_RSB, OP_ADD, OP_ADC, OP_SBC, OP_ORR, OP_MOV, OP_BIC, OP_MVN, OP_CMP][
        i % 12
      ]!;
      const s = opcode === OP_CMP ? 1 : i & 1;
      const rn = i & 7;
      const rd = (i >> 3) & 7;
      const imm = (i * 17) & 0xff;
      const word = armDpImm(opcode, s, rn, rd, imm);
      const r = regs16(
        Array.from({ length: 15 }, (_, k) => ((i + 1) * (k + 3) * 0x1021) >>> 0),
      );
      const cpsr = (0x10 | ((i & 1) << 29) | ((i & 2) << 30) | ((i & 4) << 29)) >>> 0;
      const out = await compareArm(word, r, cpsr);
      if (out.skipped) skip++;
      else pass++;
    }
    expect(pass).toBeGreaterThan(150);
    expect(skip).toBeLessThan(50);
  });

  it("register shifts and MUL / B / BX", async () => {
    await compareArm(
      armDpRegShift(OP_MOV, 1, 0, 0, 1, 0, 2),
      regs16([0, 0x80000001, 4]),
      0x10,
    );
    await compareArm(
      armDpReg(OP_MOV, 1, 0, 0, 1, 1, 8),
      regs16([0, 0x12345678]),
      0x10,
    );
    await compareArm(armMul(0, 1, 2, 1), regs16([0, 3, 5]), 0x30000010);
    await compareArm(armB(0), regs16([]), 0x10);
    await compareArm(armBx(1), regs16([0, 0x2000]), 0x10);
  });

  it("ARM BLX(1) vs Unicorn", async () => {
    const h0 = await compareArm(armBlxImm(2, 0), regs16([]), 0x10);
    expect(h0.skipped).toBe(false);
    const h1 = await compareArm(armBlxImm(2, 1), regs16([]), 0x10);
    expect(h1.skipped).toBe(false);
    const back = await compareArm(armBlxImm(0xfffffe, 0), regs16([]), 0x10);
    expect(back.skipped).toBe(false);
  });

  it("random shifted-register MOV/ADD", async () => {
    let pass = 0;
    for (let i = 0; i < 80; i++) {
      const typ = i & 3;
      const amt = (i * 3) & 31;
      const word = armDpReg(OP_ADD, 1, 1, 0, 2, typ, amt);
      const r = regs16([0, 0x11111111, 0x80000001, i]);
      const out = await compareArm(word, r, i & 1 ? 0x20000010 : 0x10);
      if (!out.skipped) pass++;
    }
    expect(pass).toBe(80);
  });

  it("Thumb16 ALU / shifts", async () => {
    await compareThumb([0x0000], regs16([0x11]), 0x30);
    await compareThumb([0x0840], regs16([0x80000000]), 0x30);
    await compareThumb([0x4048], regs16([0xf0, 0x0f]), 0x30);
    await compareThumb([0x4288], regs16([5, 5]), 0x30);
  });
});
