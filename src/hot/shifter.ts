/**
 * ARM barrel shifter, including shift #0 encodings.
 *
 * Immediate:
 *   LSL #0 → no shift, C unchanged
 *   LSR #0 → LSR #32
 *   ASR #0 → ASR #32
 *   ROR #0 → RRX
 *
 * Register:
 *   Rs[7:0]==0 → no shift, C unchanged
 *   LSL/LSR amount 32 and >32 as in ARM ARM
 *   ASR >=32 → all sign bits
 *   ROR: if Rs[7:0] != 0 && (Rs[4:0]==0) → C = Rm[31], result = Rm
 */

export type ShiftOut = { val: number; c: number };

export function ror32(val: number, rot: number): number {
  const r = rot & 31;
  if (r === 0) return val >>> 0;
  return ((val >>> r) | (val << (32 - r))) >>> 0;
}

/** ARM immediate shifter: 8-bit imm rotated right by 2*rot. */
export function armExpandImm(imm12: number, carryIn: number): ShiftOut {
  const imm8 = imm12 & 0xff;
  const rot = (imm12 >>> 8) & 0xf;
  if (rot === 0) return { val: imm8, c: carryIn };
  const val = ror32(imm8, rot * 2);
  return { val, c: val >>> 31 };
}

export function shiftImm(
  rm: number,
  type: number,
  amount: number,
  carryIn: number,
): ShiftOut {
  const x = rm >>> 0;
  amount &= 31;
  switch (type) {
    case 0: {
      if (amount === 0) return { val: x, c: carryIn };
      return { val: (x << amount) >>> 0, c: (x >>> (32 - amount)) & 1 };
    }
    case 1: {
      if (amount === 0) return { val: 0, c: x >>> 31 };
      return { val: x >>> amount, c: (x >>> (amount - 1)) & 1 };
    }
    case 2: {
      if (amount === 0) {
        const sign = x >>> 31;
        return { val: sign ? 0xffffffff : 0, c: sign };
      }
      return { val: (x << 0) >> amount >>> 0, c: (x >>> (amount - 1)) & 1 };
    }
    default: {
      if (amount === 0) {
        return { val: ((carryIn << 31) | (x >>> 1)) >>> 0, c: x & 1 };
      }
      return { val: ror32(x, amount), c: (x >>> (amount - 1)) & 1 };
    }
  }
}

export function shiftReg(
  rm: number,
  type: number,
  rsLow8: number,
  carryIn: number,
): ShiftOut {
  const x = rm >>> 0;
  const amt = rsLow8 & 0xff;
  if (amt === 0) return { val: x, c: carryIn };
  switch (type) {
    case 0: {
      if (amt < 32) return { val: (x << amt) >>> 0, c: (x >>> (32 - amt)) & 1 };
      if (amt === 32) return { val: 0, c: x & 1 };
      return { val: 0, c: 0 };
    }
    case 1: {
      if (amt < 32) return { val: x >>> amt, c: (x >>> (amt - 1)) & 1 };
      if (amt === 32) return { val: 0, c: x >>> 31 };
      return { val: 0, c: 0 };
    }
    case 2: {
      if (amt < 32) return { val: (x << 0) >> amt >>> 0, c: (x >>> (amt - 1)) & 1 };
      const sign = x >>> 31;
      return { val: sign ? 0xffffffff : 0, c: sign };
    }
    default: {
      const r = amt & 31;
      if (r === 0) return { val: x, c: x >>> 31 };
      return { val: ror32(x, r), c: (x >>> (r - 1)) & 1 };
    }
  }
}

/** Thumb-2 modified immediate (12-bit encoding). */
export function thumbExpandImm(imm12: number, carryIn: number): ShiftOut {
  const i_imm3_a = (imm12 >>> 7) & 0x1f;
  const bcdefgh = imm12 & 0x7f;
  if (i_imm3_a < 8) {
    switch (i_imm3_a >>> 1) {
      case 0:
        return { val: bcdefgh, c: carryIn };
      case 1:
        return { val: (bcdefgh << 16) | bcdefgh, c: carryIn };
      case 2:
        return { val: ((bcdefgh << 24) | (bcdefgh << 8)) >>> 0, c: carryIn };
      default:
        return {
          val: ((bcdefgh << 24) | (bcdefgh << 16) | (bcdefgh << 8) | bcdefgh) >>> 0,
          c: carryIn,
        };
    }
  }
  const unrot = (0x80 | bcdefgh) >>> 0;
  const val = ror32(unrot, i_imm3_a);
  return { val, c: val >>> 31 };
}
