import {
  AUX_ADD,
  AUX_LDM_P,
  AUX_LDM_U,
  AUX_LDM_W,
  AUX_PREINDEX,
  AUX_REG_OFFSET,
  AUX_THUMB32,
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
  out[idx] = packW0(op, cond, rd, rn, rm, shiftType, s, aux | AUX_THUMB32);
  out[idx + 1] = w1 >>> 0;
  out[idx + 2] = w2 >>> 0;
}

function undef(out: Uint32Array, idx: number, hw1: number, hw2: number): void {
  emit(out, idx, Op.UNDEF, COND_AL, 0, 0, 0, 0, 0, 0, ((hw1 & 0xffff) << 16) | (hw2 & 0xffff), 0);
}

function signExt(val: number, bits: number): number {
  const s = 32 - bits;
  return (val << s) >> s;
}

export function decodeThumb32(hw1: number, hw2: number, out: Uint32Array, idx: number): void {
  hw1 &= 0xffff;
  hw2 &= 0xffff;
  const op1 = (hw1 >>> 11) & 3;

  // BL / BLX / B.W
  if (op1 === 2) {
    const s = (hw1 >>> 10) & 1;
    const j1 = (hw2 >>> 13) & 1;
    const j2 = (hw2 >>> 11) & 1;
    const i1 = (j1 ^ s) ^ 1;
    const i2 = (j2 ^ s) ^ 1;
    if ((hw2 & 0xd000) === 0xd000) {
      const imm =
        (s << 24) | (i1 << 23) | (i2 << 22) | ((hw1 & 0x3ff) << 12) | ((hw2 & 0x7ff) << 1);
      emit(out, idx, Op.BL, COND_AL, 0, 0, 0, 0, 0, 0, signExt(imm, 25) >>> 0, 0);
      return;
    }
    if ((hw2 & 0xd000) === 0xc000) {
      const imm =
        (s << 24) | (i1 << 23) | (i2 << 22) | ((hw1 & 0x3ff) << 12) | ((hw2 & 0x7fe) << 1);
      emit(out, idx, Op.BLX, COND_AL, 0, 0, 0, 0, 0, 0, signExt(imm, 25) >>> 0, 1);
      return;
    }
    if ((hw2 & 0xd000) === 0x9000) {
      const imm =
        (s << 24) | (i1 << 23) | (i2 << 22) | ((hw1 & 0x3ff) << 12) | ((hw2 & 0x7ff) << 1);
      emit(out, idx, Op.B, COND_AL, 0, 0, 0, 0, 0, 0, signExt(imm, 25) >>> 0, 0);
      return;
    }
    if ((hw2 & 0xd000) === 0x8000) {
      const cond = (hw1 >>> 6) & 0xf;
      if (cond >= 0xe) {
        undef(out, idx, hw1, hw2);
        return;
      }
      const imm =
        (s << 20) |
        (j2 << 19) |
        (j1 << 18) |
        ((hw1 & 0x3f) << 12) |
        ((hw2 & 0x7ff) << 1);
      emit(out, idx, Op.B, cond, 0, 0, 0, 0, 0, 0, signExt(imm, 21) >>> 0, 0);
      return;
    }
  }

  // MOVW / MOVT
  if ((hw1 & 0xfbf0) === 0xf240 && (hw2 & 0x8000) === 0) {
    const imm =
      ((hw1 & 0xf) << 12) | ((hw1 << 1) & 0x800) | ((hw2 >>> 4) & 0x700) | (hw2 & 0xff);
    const rd = (hw2 >>> 8) & 0xf;
    emit(out, idx, Op.MOVW, COND_AL, rd, 0, 0, 0, 0, 0, imm, 0);
    return;
  }
  if ((hw1 & 0xfbf0) === 0xf2c0 && (hw2 & 0x8000) === 0) {
    const imm =
      ((hw1 & 0xf) << 12) | ((hw1 << 1) & 0x800) | ((hw2 >>> 4) & 0x700) | (hw2 & 0xff);
    const rd = (hw2 >>> 8) & 0xf;
    emit(out, idx, Op.MOVT, COND_AL, rd, 0, 0, 0, 0, 0, imm, 0);
    return;
  }

  // ADDW / SUBW
  if ((hw1 & 0xfbf0) === 0xf200 && (hw2 & 0x8000) === 0) {
    const rn = hw1 & 0xf;
    const rd = (hw2 >>> 8) & 0xf;
    const imm =
      ((hw1 << 1) & 0x800) | ((hw2 >>> 4) & 0x700) | (hw2 & 0xff);
    emit(out, idx, Op.ADD, COND_AL, rd, rn, 0, 0, 0, 0, imm, 4);
    return;
  }
  if ((hw1 & 0xfbf0) === 0xf2a0 && (hw2 & 0x8000) === 0) {
    const rn = hw1 & 0xf;
    const rd = (hw2 >>> 8) & 0xf;
    const imm =
      ((hw1 << 1) & 0x800) | ((hw2 >>> 4) & 0x700) | (hw2 & 0xff);
    emit(out, idx, Op.SUB, COND_AL, rd, rn, 0, 0, 0, 0, imm, 4);
    return;
  }

  // Modified immediate data processing: 11110 i 0xxxx S Rn | 0 imm3 Rd imm8
  if ((hw1 & 0xf800) === 0xf000 && (hw2 & 0x8000) === 0) {
    const op = (hw1 >>> 5) & 0xf;
    const s = (hw1 >>> 4) & 1;
    const rn = hw1 & 0xf;
    const rd = (hw2 >>> 8) & 0xf;
    const imm12 =
      ((hw1 << 1) & 0x800) | ((hw2 >>> 4) & 0x700) | (hw2 & 0xff);
    const map: Record<number, number> = {
      0x0: Op.AND,
      0x1: Op.BIC,
      0x2: Op.ORR,
      0x3: Op.MVN, // ORN ~imm via MVN-ish; handled as ORN in interp via w2=2
      0x4: Op.EOR,
      0x8: Op.ADD,
      0xa: Op.ADC,
      0xb: Op.SBC,
      0xd: Op.SUB,
      0xe: Op.RSB,
    };
    if (op === 0x2 && rn === 15) {
      emit(out, idx, Op.MOV, COND_AL, rd, 0, 0, 0, s, 0, imm12, 2);
      return;
    }
    if (op === 0x3 && rn === 15) {
      emit(out, idx, Op.MVN, COND_AL, rd, 0, 0, 0, s, 0, imm12, 2);
      return;
    }
    if (op === 0x0 && rd === 15 && s) {
      emit(out, idx, Op.TST, COND_AL, 0, rn, 0, 0, 1, 0, imm12, 2);
      return;
    }
    if (op === 0x4 && rd === 15 && s) {
      emit(out, idx, Op.TEQ, COND_AL, 0, rn, 0, 0, 1, 0, imm12, 2);
      return;
    }
    if (op === 0x8 && rd === 15 && s) {
      emit(out, idx, Op.CMN, COND_AL, 0, rn, 0, 0, 1, 0, imm12, 2);
      return;
    }
    if (op === 0xd && rd === 15 && s) {
      emit(out, idx, Op.CMP, COND_AL, 0, rn, 0, 0, 1, 0, imm12, 2);
      return;
    }
    const mapped = map[op];
    if (mapped !== undefined) {
      const extra = op === 0x3 ? 3 : 2;
      emit(out, idx, mapped, COND_AL, rd, rn, 0, 0, s, 0, imm12, extra);
      return;
    }
  }

  // Shifted-register data processing: 11101 01 xxxx S Rn | 0 imm3 Rd imm2 type Rm
  if ((hw1 & 0xff00) === 0xea00 && (hw2 & 0x8000) === 0) {
    const op = (hw1 >>> 5) & 0xf;
    const s = (hw1 >>> 4) & 1;
    const rn = hw1 & 0xf;
    const rd = (hw2 >>> 8) & 0xf;
    const rm = hw2 & 0xf;
    const typ = (hw2 >>> 4) & 3;
    const imm = ((hw2 >>> 10) & 0x1c) | ((hw2 >>> 6) & 3);
    const map: Record<number, number> = {
      0x0: Op.AND,
      0x1: Op.BIC,
      0x2: Op.ORR,
      0x3: Op.MVN,
      0x4: Op.EOR,
      0x8: Op.ADD,
      0xa: Op.ADC,
      0xb: Op.SBC,
      0xd: Op.SUB,
      0xe: Op.RSB,
    };
    if (op === 0x2 && rn === 15) {
      emit(out, idx, Op.MOV, COND_AL, rd, 0, rm, typ, s, 0, imm, 0);
      return;
    }
    if (op === 0x3 && rn === 15) {
      emit(out, idx, Op.MVN, COND_AL, rd, 0, rm, typ, s, 0, imm, 0);
      return;
    }
    const mapped = map[op];
    if (mapped !== undefined) {
      emit(out, idx, mapped, COND_AL, rd, rn, rm, typ, s, op === 0x3 ? 0 : 0, imm, 0);
      return;
    }
  }

  // CLZ.W
  if ((hw1 & 0xfff0) === 0xfab0 && (hw2 & 0xf0f0) === 0xf080) {
    emit(out, idx, Op.CLZ, COND_AL, (hw2 >>> 8) & 0xf, 0, hw2 & 0xf, 0, 0, 0, 0, 0);
    return;
  }

  // LDR/STR word/byte/half, imm12 and imm8 forms (T3/T4)
  if ((hw1 & 0xfe40) === 0xf840) {
    decodeT32Ls(hw1, hw2, out, idx);
    return;
  }

  // LDM/STM.W  11101 00 0 W L Rn | P M list
  if ((hw1 & 0xfe50) === 0xe810) {
    const w = (hw1 >>> 5) & 1;
    const l = (hw1 >>> 4) & 1;
    const rn = hw1 & 0xf;
    const list = hw2 & 0xffff;
    const pu = (hw1 >>> 7) & 3; // not quite — T32 uses separate encodings
    // STMIA / LDMIA: 1110 1000 W L
    // STMDB / LDMDB: 1110 1001 W L
    const db = (hw1 >>> 8) & 1;
    let aux = 0;
    if (db) aux |= AUX_LDM_P;
    else aux |= AUX_LDM_U;
    if (!db) {
      /* IA: U=1 P=0 */
    } else {
      /* DB: U=0 P=1 */
    }
    if (w) aux |= AUX_LDM_W;
    emit(out, idx, l ? Op.LDM : Op.STM, COND_AL, 0, rn, 0, 0, 0, aux, list, 0);
    return;
  }

  // DSB/DMB/ISB / NOP.W
  if ((hw1 & 0xffff) === 0xf3af && (hw2 & 0xff00) === 0x8000) {
    emit(out, idx, Op.NOP, COND_AL, 0, 0, 0, 0, 0, 0, 0, 0);
    return;
  }

  undef(out, idx, hw1, hw2);
}

function decodeT32Ls(hw1: number, hw2: number, out: Uint32Array, idx: number): void {
  const l = (hw1 >>> 4) & 1;
  const rn = hw1 & 0xf;
  const rt = (hw2 >>> 12) & 0xf;
  const size = (hw1 >>> 5) & 3; // 00=byte 01=half 10=word
  const sign = (hw1 >>> 8) & 1; // used in some encodings; T3 word doesn't
  let op = Op.UNDEF;
  if (size === 2) op = l ? Op.LDR : Op.STR;
  else if (size === 1) op = l ? Op.LDRH : Op.STRH;
  else if (size === 0) op = l ? Op.LDRB : Op.STRB;
  else {
    undef(out, idx, hw1, hw2);
    return;
  }
  // signed variants: 11111 00 1 size 1
  if ((hw1 & 0xfe00) === 0xf900 && l) {
    if (size === 0) op = Op.LDRSB;
    else if (size === 1) op = Op.LDRSH;
  }

  if ((hw1 & 0xfe80) === 0xf880) {
    // imm12, U=1 P=1 W=0
    const imm = hw2 & 0xfff;
    emit(out, idx, op, COND_AL, rt, rn, 0, 0, 0, AUX_PREINDEX | AUX_ADD, imm, 0);
    return;
  }
  if ((hw2 & 0x0d00) === 0x0c00 || (hw2 & 0x0f00) === 0x0e00 || (hw2 & 0x0b00) === 0x0900) {
    const imm = hw2 & 0xff;
    const p = (hw2 >>> 10) & 1;
    const u = (hw2 >>> 9) & 1;
    const w = (hw2 >>> 8) & 1;
    let aux = 0;
    if (p) aux |= AUX_PREINDEX;
    if (u) aux |= AUX_ADD;
    if (w || !p) aux |= AUX_WRITEBACK;
    emit(out, idx, op, COND_AL, rt, rn, 0, 0, 0, aux, imm, 0);
    return;
  }
  if ((hw2 & 0x0fc0) === 0x0000) {
    const rm = hw2 & 0xf;
    const shift = (hw2 >>> 4) & 3;
    emit(
      out,
      idx,
      op,
      COND_AL,
      rt,
      rn,
      rm,
      0,
      0,
      AUX_PREINDEX | AUX_ADD | AUX_REG_OFFSET,
      shift,
      0,
    );
    return;
  }
  undef(out, idx, hw1, hw2);
}
