import {
  AUX_ADD,
  AUX_LDM_P,
  AUX_LDM_U,
  AUX_LDM_W,
  AUX_PREINDEX,
  AUX_REG_OFFSET,
  AUX_WRITEBACK,
  COND_AL,
  Op,
  packW0,
} from "./opcodes.ts";

function emit(
  out: Uint32Array,
  idx: number,
  op: number,
  cond: number,
  rd: number,
  rn: number,
  rm: number,
  shiftType: number,
  s: number,
  aux: number,
  w1: number,
  w2 = 0,
): void {
  out[idx] = packW0(op, cond, rd, rn, rm, shiftType, s, aux);
  out[idx + 1] = w1 >>> 0;
  out[idx + 2] = w2 >>> 0;
}

function undef(out: Uint32Array, idx: number, hw: number): void {
  emit(out, idx, Op.UNDEF, COND_AL, 0, 0, 0, 0, 0, 0, hw & 0xffff, 0);
}

const ALU16 = [
  Op.AND,
  Op.EOR,
  Op.MOV, // LSL
  Op.MOV, // LSR
  Op.MOV, // ASR
  Op.ADC,
  Op.SBC,
  Op.MOV, // ROR
  Op.TST,
  Op.RSB, // NEG
  Op.CMP,
  Op.CMN,
  Op.ORR,
  Op.MUL,
  Op.BIC,
  Op.MVN,
] as const;

/** bits[15:11] in {11101,11110,11111} → Thumb-32 prefix */
export function isThumb32Prefix(hw: number): boolean {
  return (hw >>> 11) >= 0x1d;
}

export function decodeThumb16(hw: number, out: Uint32Array, idx: number): void {
  hw &= 0xffff;
  const top = hw >>> 13;

  if ((hw >>> 13) === 0) {
    const typ = (hw >>> 11) & 3;
    const amt = (hw >>> 6) & 0x1f;
    const rm = (hw >>> 3) & 7;
    const rd = hw & 7;
    if (typ === 3) {
      // add/sub
      const sub = (hw >>> 9) & 1;
      const imm = (hw >>> 10) & 1;
      const rd2 = hw & 7;
      const rn = (hw >>> 3) & 7;
      if (imm) {
        emit(out, idx, sub ? Op.SUB : Op.ADD, COND_AL, rd2, rn, 0, 0, 1, 0, (hw >>> 6) & 7, 4);
      } else {
        emit(out, idx, sub ? Op.SUB : Op.ADD, COND_AL, rd2, rn, (hw >>> 6) & 7, 0, 1, 0, 0, 0);
      }
      return;
    }
    emit(out, idx, Op.MOV, COND_AL, rd, 0, rm, typ, 1, 0, amt, 0);
    return;
  }

  if (top === 1) {
    const op = (hw >>> 11) & 3;
    const rd = (hw >>> 8) & 7;
    const imm = hw & 0xff;
    if (op === 0) emit(out, idx, Op.MOV, COND_AL, rd, 0, 0, 0, 1, 0, imm, 4);
    else if (op === 1) emit(out, idx, Op.CMP, COND_AL, 0, rd, 0, 0, 1, 0, imm, 4);
    else if (op === 2) emit(out, idx, Op.ADD, COND_AL, rd, rd, 0, 0, 1, 0, imm, 4);
    else emit(out, idx, Op.SUB, COND_AL, rd, rd, 0, 0, 1, 0, imm, 4);
    return;
  }

  if ((hw & 0xfc00) === 0x4000) {
    const op = (hw >>> 6) & 0xf;
    const rs = (hw >>> 3) & 7;
    const rd = hw & 7;
    if (op === 2 || op === 3 || op === 4 || op === 7) {
      emit(out, idx, Op.MOV, COND_AL, rd, 0, rd, op === 2 ? 0 : op === 3 ? 1 : op === 4 ? 2 : 3, 1, 1, 0, rs);
      return;
    }
    if (op === 9) {
      emit(out, idx, Op.RSB, COND_AL, rd, rs, 0, 0, 1, 0, 0, 4);
      return;
    }
    if (op === 13) {
      emit(out, idx, Op.MUL, COND_AL, rd, 0, rd, 0, 1, 0, rs, 0);
      return;
    }
    const alu = ALU16[op]!;
    const s = 1;
    emit(out, idx, alu, COND_AL, rd, rd, rs, 0, s, 0, 0, 0);
    return;
  }

  if ((hw & 0xfc00) === 0x4400) {
    const op = (hw >>> 8) & 3;
    const rdn = ((hw >>> 4) & 8) | (hw & 7);
    const rm = (hw >>> 3) & 0xf;
    if (op === 3) {
      emit(out, idx, (hw & 0x80) !== 0 ? Op.BLX : Op.BX, COND_AL, 0, 0, rm, 0, 0, 0, 0, 0);
      return;
    }
    if (op === 0) emit(out, idx, Op.ADD, COND_AL, rdn, rdn, rm, 0, 0, 0, 0, 0);
    else if (op === 1) emit(out, idx, Op.CMP, COND_AL, 0, rdn, rm, 0, 1, 0, 0, 0);
    else emit(out, idx, Op.MOV, COND_AL, rdn, 0, rm, 0, 0, 0, 0, 0);
    return;
  }

  if ((hw & 0xf800) === 0x4800) {
    const rd = (hw >>> 8) & 7;
    emit(out, idx, Op.LDR, COND_AL, rd, 15, 0, 0, 0, AUX_PREINDEX | AUX_ADD, (hw & 0xff) << 2, 0);
    return;
  }

  if ((hw & 0xf000) === 0x5000) {
    const op = (hw >>> 9) & 7;
    const rm = (hw >>> 6) & 7;
    const rn = (hw >>> 3) & 7;
    const rd = hw & 7;
    const map = [Op.STR, Op.STRH, Op.STRB, Op.LDRSB, Op.LDR, Op.LDRH, Op.LDRB, Op.LDRSH];
    emit(
      out,
      idx,
      map[op]!,
      COND_AL,
      rd,
      rn,
      rm,
      0,
      0,
      AUX_PREINDEX | AUX_ADD | AUX_REG_OFFSET,
      0,
      0,
    );
    return;
  }

  if ((hw & 0xe000) === 0x6000) {
    const b = (hw >>> 12) & 1;
    const l = (hw >>> 11) & 1;
    const imm = (hw >>> 6) & 0x1f;
    const rn = (hw >>> 3) & 7;
    const rd = hw & 7;
    const off = b ? imm : imm << 2;
    const op = l ? (b ? Op.LDRB : Op.LDR) : b ? Op.STRB : Op.STR;
    emit(out, idx, op, COND_AL, rd, rn, 0, 0, 0, AUX_PREINDEX | AUX_ADD, off, 0);
    return;
  }

  if ((hw & 0xf000) === 0x8000) {
    const l = (hw >>> 11) & 1;
    const imm = ((hw >>> 6) & 0x1f) << 1;
    const rn = (hw >>> 3) & 7;
    const rd = hw & 7;
    emit(out, idx, l ? Op.LDRH : Op.STRH, COND_AL, rd, rn, 0, 0, 0, AUX_PREINDEX | AUX_ADD, imm, 0);
    return;
  }

  if ((hw & 0xf000) === 0x9000) {
    const l = (hw >>> 11) & 1;
    const rd = (hw >>> 8) & 7;
    emit(out, idx, l ? Op.LDR : Op.STR, COND_AL, rd, 13, 0, 0, 0, AUX_PREINDEX | AUX_ADD, (hw & 0xff) << 2, 0);
    return;
  }

  if ((hw & 0xf000) === 0xa000) {
    const sp = (hw >>> 11) & 1;
    const rd = (hw >>> 8) & 7;
    emit(out, idx, Op.ADD, COND_AL, rd, sp ? 13 : 15, 0, 0, 0, 0, (hw & 0xff) << 2, 4);
    return;
  }

  if ((hw & 0xff00) === 0xb000) {
    const sub = (hw >>> 7) & 1;
    emit(out, idx, sub ? Op.SUB : Op.ADD, COND_AL, 13, 13, 0, 0, 0, 0, (hw & 0x7f) << 2, 4);
    return;
  }

  if ((hw & 0xf600) === 0xb400) {
    const l = (hw >>> 11) & 1;
    const r = (hw >>> 8) & 1;
    let list = hw & 0xff;
    if (r) list |= l ? 1 << 15 : 1 << 14;
    const aux = l
      ? AUX_LDM_U | AUX_LDM_W
      : AUX_LDM_P | AUX_LDM_W;
    emit(out, idx, l ? Op.LDM : Op.STM, COND_AL, 0, 13, 0, 0, 0, aux, list, 0);
    return;
  }

  if ((hw & 0xffc0) === 0xb200) {
    const rm = (hw >>> 3) & 7;
    const rd = hw & 7;
    const k = (hw >>> 6) & 3;
    const op = [Op.SXTH, Op.SXTB, Op.UXTH, Op.UXTB][k]!;
    emit(out, idx, op, COND_AL, rd, 0, rm, 0, 0, 0, 0, 0);
    return;
  }

  if ((hw & 0xffc0) === 0xba00) {
    const rm = (hw >>> 3) & 7;
    const rd = hw & 7;
    const k = (hw >>> 6) & 3;
    if (k === 2) {
      undef(out, idx, hw);
      return;
    }
    const op = [Op.REV, Op.REV16, Op.UNDEF, Op.REVSH][k]!;
    emit(out, idx, op, COND_AL, rd, 0, rm, 0, 0, 0, 0, 0);
    return;
  }

  if ((hw & 0xff00) === 0xbe00) {
    emit(out, idx, Op.BKPT, COND_AL, 0, 0, 0, 0, 0, 0, hw & 0xff, 0);
    return;
  }

  if ((hw & 0xff00) === 0xbf00) {
    if ((hw & 0xff) === 0) {
      emit(out, idx, Op.NOP, COND_AL, 0, 0, 0, 0, 0, 0, 0, 0);
      return;
    }
    const firstcond = (hw >>> 4) & 0xf;
    const mask = hw & 0xf;
    if (mask === 0 || firstcond === 0xf) {
      undef(out, idx, hw);
      return;
    }
    emit(out, idx, Op.IT, COND_AL, 0, 0, 0, 0, 0, 0, (firstcond << 4) | mask, 0);
    return;
  }

  if ((hw & 0xf500) === 0xb100) {
    const n = (hw >>> 11) & 1;
    const rn = hw & 7;
    const imm = ((hw >>> 3) & 0x1f) | (((hw >>> 9) & 1) << 5);
    emit(out, idx, n ? Op.CBNZ : Op.CBZ, COND_AL, 0, rn, 0, 0, 0, 0, imm << 1, 0);
    return;
  }

  if ((hw & 0xf000) === 0xc000) {
    const l = (hw >>> 11) & 1;
    const rn = (hw >>> 8) & 7;
    const list = hw & 0xff;
    emit(out, idx, l ? Op.LDM : Op.STM, COND_AL, 0, rn, 0, 0, 0, AUX_LDM_U | AUX_LDM_W, list, 0);
    return;
  }

  if ((hw & 0xf000) === 0xd000) {
    const cond = (hw >>> 8) & 0xf;
    if (cond === 0xf) {
      emit(out, idx, Op.SVC, COND_AL, 0, 0, 0, 0, 0, 0, hw & 0xff, 0);
      return;
    }
    if (cond === 0xe) {
      undef(out, idx, hw);
      return;
    }
    const off = ((hw << 24) >> 24) << 1;
    emit(out, idx, Op.B, cond, 0, 0, 0, 0, 0, 0, off >>> 0, 0);
    return;
  }

  if ((hw & 0xf800) === 0xe000) {
    const off = ((hw << 21) >> 21) << 1;
    emit(out, idx, Op.B, COND_AL, 0, 0, 0, 0, 0, 0, off >>> 0, 0);
    return;
  }

  undef(out, idx, hw);
}
