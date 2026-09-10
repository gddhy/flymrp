import { describe, expect, it } from "vitest";
import { decodeArm } from "../src/hot/decode-arm.ts";
import { Op, unpackW0 } from "../src/hot/opcodes.ts";
import {
  AL,
  OP_ADD,
  OP_ADC,
  OP_CMP,
  OP_MOV,
  OP_SUB,
  armB,
  armBlxImm,
  armBx,
  armDpImm,
  armDpReg,
  armLdrImm,
  armMul,
} from "./helpers/asm.ts";

function dec(word: number) {
  const out = new Uint32Array(3);
  decodeArm(word, out, 0);
  return { ...unpackW0(out[0]!), w1: out[1]!, w2: out[2]! };
}

describe("3-B ARM decoder", () => {
  it("decodes ADDS r0, r1, #1", () => {
    const d = dec(armDpImm(OP_ADD, 1, 1, 0, 1));
    expect(d.op).toBe(Op.ADD);
    expect(d.s).toBe(1);
    expect(d.rd).toBe(0);
    expect(d.rn).toBe(1);
    expect(d.w1).toBe(1);
    expect(d.w2).toBe(1);
    expect(d.cond).toBe(AL);
  });

  it("decodes SUB / ADC / CMP / MOV", () => {
    expect(dec(armDpImm(OP_SUB, 1, 1, 0, 1)).op).toBe(Op.SUB);
    expect(dec(armDpReg(OP_ADC, 1, 1, 0, 2)).op).toBe(Op.ADC);
    expect(dec(armDpImm(OP_CMP, 1, 1, 0, 1)).op).toBe(Op.CMP);
    expect(dec(armDpReg(OP_MOV, 1, 0, 0, 1, 0, 0)).op).toBe(Op.MOV);
  });

  it("decodes LSL #0 / LSR #0 / ASR #0 / ROR #0 (RRX)", () => {
    const lsl0 = dec(armDpReg(OP_MOV, 1, 0, 0, 1, 0, 0));
    expect(lsl0.shiftType).toBe(0);
    expect(lsl0.w1).toBe(0);
    const lsr0 = dec(armDpReg(OP_MOV, 1, 0, 0, 1, 1, 0));
    expect(lsr0.shiftType).toBe(1);
    expect(lsr0.w1).toBe(0);
    const asr0 = dec(armDpReg(OP_MOV, 1, 0, 0, 1, 2, 0));
    expect(asr0.shiftType).toBe(2);
    const ror0 = dec(armDpReg(OP_MOV, 1, 0, 0, 1, 3, 0));
    expect(ror0.shiftType).toBe(3);
    expect(ror0.aux & 2).toBe(2);
  });

  it("decodes B / BX / MUL / LDR", () => {
    expect(dec(armB(0, 0)).op).toBe(Op.B);
    expect(dec(armB(4, 1)).op).toBe(Op.BL);
    expect(dec(armBx(14)).op).toBe(Op.BX);
    expect(dec(armBx(14)).rm).toBe(14);
    expect(dec(armMul(0, 1, 2, 1)).op).toBe(Op.MUL);
    const ldr = dec(armLdrImm(1, 0, 8));
    expect(ldr.op).toBe(Op.LDR);
    expect(ldr.rd).toBe(1);
    expect(ldr.rn).toBe(0);
    expect(ldr.w1).toBe(8);
  });

  it("marks coprocessor / media as UNDEF", () => {
    expect(dec(0xee000000).op).toBe(Op.UNDEF);
    expect(dec(0xe16000f0).op).toBe(Op.UNDEF);
  });

  it("decodes SVC", () => {
    const d = dec(0xef0000ab);
    expect(d.op).toBe(Op.SVC);
    expect(d.w1).toBe(0xab);
  });

  it("decodes ARM BLX(1) 0xfa00977c and H=0/1 immediates", () => {
    const real = dec(0xfa00977c);
    expect(real.op).toBe(Op.BLX);
    expect(real.cond).toBe(AL);
    expect(real.w2 & 0xff).toBe(1);
    expect(real.w1 | 0).toBe((0x00977c << 2) | 0);
    const h0 = dec(armBlxImm(2, 0));
    expect(h0.op).toBe(Op.BLX);
    expect(h0.w1 | 0).toBe(8);
    const h1 = dec(armBlxImm(2, 1));
    expect(h1.op).toBe(Op.BLX);
    expect(h1.w1 | 0).toBe(10);
  });
});
