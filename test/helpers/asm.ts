/** Tiny ARM/Thumb encoders for tests. */

export const AL = 0xe;

export function armDpImm(
  opcode: number,
  s: number,
  rn: number,
  rd: number,
  imm12: number,
  cond = AL,
): number {
  return (
    ((cond & 0xf) << 28) |
    (1 << 25) |
    ((opcode & 0xf) << 21) |
    ((s & 1) << 20) |
    ((rn & 0xf) << 16) |
    ((rd & 0xf) << 12) |
    (imm12 & 0xfff)
  ) >>> 0;
}

export function armDpReg(
  opcode: number,
  s: number,
  rn: number,
  rd: number,
  rm: number,
  shiftType = 0,
  shiftAmt = 0,
  cond = AL,
): number {
  return (
    ((cond & 0xf) << 28) |
    ((opcode & 0xf) << 21) |
    ((s & 1) << 20) |
    ((rn & 0xf) << 16) |
    ((rd & 0xf) << 12) |
    ((shiftAmt & 0x1f) << 7) |
    ((shiftType & 3) << 5) |
    (rm & 0xf)
  ) >>> 0;
}

export function armDpRegShift(
  opcode: number,
  s: number,
  rn: number,
  rd: number,
  rm: number,
  shiftType: number,
  rs: number,
  cond = AL,
): number {
  return (
    ((cond & 0xf) << 28) |
    ((opcode & 0xf) << 21) |
    ((s & 1) << 20) |
    ((rn & 0xf) << 16) |
    ((rd & 0xf) << 12) |
    ((rs & 0xf) << 8) |
    ((shiftType & 3) << 5) |
    (1 << 4) |
    (rm & 0xf)
  ) >>> 0;
}

export function armB(offset: number, link = 0, cond = AL): number {
  return (((cond & 0xf) << 28) | (5 << 25) | ((link & 1) << 24) | (offset & 0xff_ffff)) >>> 0;
}

export function armBx(rm: number, cond = AL): number {
  return (((cond & 0xf) << 28) | 0x012fff10 | (rm & 0xf)) >>> 0;
}

export function armBlx(rm: number, cond = AL): number {
  return (((cond & 0xf) << 28) | 0x012fff30 | (rm & 0xf)) >>> 0;
}

/** ARM BLX(1): 1111 101 H imm24. H is the extra offset bit, not the T-bit. */
export function armBlxImm(imm24: number, h = 0): number {
  return (0xfa00_0000 | ((h & 1) << 24) | (imm24 & 0xff_ffff)) >>> 0;
}

export function armPush(list: number): number {
  return (0xe92d0000 | (list & 0xffff)) >>> 0;
}

export function armPop(list: number): number {
  return (0xe8bd0000 | (list & 0xffff)) >>> 0;
}

export function armBTo(from: number, to: number, link = 0, cond = AL): number {
  const off = ((to - (from + 8)) >> 2) & 0xff_ffff;
  return armB(off, link, cond);
}

export const EQ = 0;
export const NE = 1;

export function thumbMovImm(rd: number, imm8: number): number {
  return (0x2000 | ((rd & 7) << 8) | (imm8 & 0xff)) & 0xffff;
}

export function thumbBx(rm: number): number {
  return (0x4700 | ((rm & 0xf) << 3)) & 0xffff;
}

export function thumbBlx(rm: number): number {
  return (0x4780 | ((rm & 0xf) << 3)) & 0xffff;
}

export function thumbLdrPc(rd: number, imm8div4: number): number {
  return (0x4800 | ((rd & 7) << 8) | (imm8div4 & 0xff)) & 0xffff;
}

export function thumbAddReg(rdn: number, rm: number): number {
  return (0x4400 | ((rm & 0xf) << 3) | (rdn & 7) | (((rdn >> 3) & 1) << 7)) & 0xffff;
}

export function armMul(rd: number, rm: number, rs: number, s = 0, cond = AL): number {
  return (
    ((cond & 0xf) << 28) |
    ((s & 1) << 20) |
    ((rd & 0xf) << 16) |
    ((rs & 0xf) << 8) |
    0x90 |
    (rm & 0xf)
  ) >>> 0;
}

export function armLdrImm(
  rd: number,
  rn: number,
  imm: number,
  load = 1,
  byte = 0,
  add = 1,
  pre = 1,
  wb = 0,
  cond = AL,
): number {
  return (
    ((cond & 0xf) << 28) |
    (1 << 26) |
    ((pre & 1) << 24) |
    ((add & 1) << 23) |
    ((byte & 1) << 22) |
    ((wb & 1) << 21) |
    ((load & 1) << 20) |
    ((rn & 0xf) << 16) |
    ((rd & 0xf) << 12) |
    (imm & 0xfff)
  ) >>> 0;
}

export const OP_AND = 0;
export const OP_EOR = 1;
export const OP_SUB = 2;
export const OP_RSB = 3;
export const OP_ADD = 4;
export const OP_ADC = 5;
export const OP_SBC = 6;
export const OP_RSC = 7;
export const OP_TST = 8;
export const OP_TEQ = 9;
export const OP_CMP = 10;
export const OP_CMN = 11;
export const OP_ORR = 12;
export const OP_MOV = 13;
export const OP_BIC = 14;
export const OP_MVN = 15;

export function le32(word: number): Uint8Array {
  const w = word >>> 0;
  return Uint8Array.of(w, w >>> 8, w >>> 16, w >>> 24);
}

export function le16(hw: number): Uint8Array {
  const h = hw & 0xffff;
  return Uint8Array.of(h, h >>> 8);
}
