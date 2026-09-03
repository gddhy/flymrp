import { EXT_CODE_ADDR, EXT_TABLE_ADDR, MRPGCMAP, tableSlotAddr } from "../../src/abi/layout.ts";
import {
  EQ,
  OP_ADD,
  OP_CMP,
  OP_MOV,
  armBlx,
  armBTo,
  armBx,
  armDpImm,
  armDpReg,
  armLdrImm,
  le32,
  thumbBlx,
  thumbBx,
  thumbLdrPc,
  thumbMovImm,
} from "./asm.ts";

export const ARM_LOAD_HELPER_OFF = 48;
export const THUMB_LOAD_HELPER_OFF = 36;

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function wordsToBytes(words: number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]! >>> 0;
    out[i * 4] = w;
    out[i * 4 + 1] = w >>> 8;
    out[i * 4 + 2] = w >>> 16;
    out[i * 4 + 3] = w >>> 24;
  }
  return out;
}

export function halfsToBytes(halfs: number[]): Uint8Array {
  const out = new Uint8Array(halfs.length * 2);
  for (let i = 0; i < halfs.length; i++) {
    const h = halfs[i]! & 0xffff;
    out[i * 2] = h;
    out[i * 2 + 1] = h >>> 8;
  }
  return out;
}

export function withMrpGcMap(payload: Uint8Array): Uint8Array {
  return concatBytes(MRPGCMAP, payload);
}

/** 8-byte header hole + payload so +8 is mr_c_function_load. */
export function withRawHeader(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  out.set(payload, 8);
  return out;
}

/**
 * ARM load stub: table[25](helper, 20); return 0.
 * Layout at dest:
 *   +0 table (patched)  +4 P (patched)  +8 load  +44 helper
 */
export function buildArmLoadImage(opts: {
  dest?: number;
  helperWords: number[];
  helperThumb?: boolean;
}): Uint8Array {
  const dest = (opts.dest ?? EXT_CODE_ADDR) >>> 0;
  const helper = dest + ARM_LOAD_HELPER_OFF;
  const helperAddr = opts.helperThumb ? helper | 1 : helper;
  const head = [
    0,
    0,
    armDpReg(OP_MOV, 0, 0, 6, 14),
    armLdrImm(0, 15, 16),
    armLdrImm(1, 15, 16),
    armLdrImm(2, 15, 16),
    armBlx(2),
    armDpImm(OP_MOV, 0, 0, 0, 0),
    armBx(6),
    helperAddr,
    20,
    tableSlotAddr(25),
  ];
  return wordsToBytes([...head, ...opts.helperWords]);
}

export function armReturnConst(imm8: number): number[] {
  return [armDpImm(OP_MOV, 0, 0, 0, imm8 & 0xff), armBx(14)];
}

export function armStoreR9ToR2(): number[] {
  return [armLdrImm(9, 2, 0, 0), armBx(14)];
}

/** ARM helper: dispatch R1 (code) to a constant return; optional code6 = BLX child. */
export function buildArmCodeHelper(opts: {
  ret0?: number;
  ret1?: number;
  ret6?: number;
  ret8?: number;
  childLoad?: number;
  storeR9ToR2?: boolean;
  writeOutput?: boolean;
}): number[] {
  const ret0 = opts.ret0 ?? 0x100;
  const ret1 = opts.ret1 ?? 0x101;
  const ret6 = opts.ret6 ?? 0x106;
  const ret8 = opts.ret8 ?? 0x108;
  // We'll emit a compact dispatch using PC-relative branches from a known base.
  // Use a relocatable blob: first word is a placeholder; tests assemble at known addr
  // via assembleArmHelperAt.
  void ret0;
  void ret1;
  void ret6;
  void ret8;
  return assembleArmHelperAt(0, opts);
}

export function assembleArmHelperAt(
  base: number,
  opts: {
    ret0?: number;
    ret1?: number;
    ret6?: number;
    ret8?: number;
    childLoad?: number;
    storeR9ToR2?: boolean;
    writeOutput?: boolean;
    addR0R1?: boolean;
    storeR9ToRw?: boolean;
  },
): number[] {
  const ret0 = opts.ret0 ?? 0x100;
  const ret1 = opts.ret1 ?? 0x101;
  const ret6 = opts.ret6 ?? 0x106;
  const ret8 = opts.ret8 ?? 0x108;
  const words: number[] = new Array(36).fill(armDpImm(OP_MOV, 0, 0, 0, 0));
  let i = 0;
  const emit = (w: number) => {
    words[i++] = w >>> 0;
  };
  const pcOf = (idx: number) => (base + idx * 4) >>> 0;

  const L0 = 12;
  const L1 = 18;
  const L6 = 20;
  const L8 = 26;
  const Ldef = 28;

  emit(armDpImm(OP_CMP, 1, 1, 0, 0));
  emit(armBTo(pcOf(1), pcOf(L0), 0, EQ));
  emit(armDpImm(OP_CMP, 1, 1, 0, 1));
  emit(armBTo(pcOf(3), pcOf(L1), 0, EQ));
  emit(armDpImm(OP_CMP, 1, 1, 0, 6));
  emit(armBTo(pcOf(5), pcOf(L6), 0, EQ));
  emit(armDpImm(OP_CMP, 1, 1, 0, 8));
  emit(armBTo(pcOf(7), pcOf(L8), 0, EQ));
  emit(armDpImm(OP_MOV, 0, 0, 0, 0));
  emit(armBx(14));
  emit(armDpImm(OP_MOV, 0, 0, 0, 0)); // pad 10
  emit(armDpImm(OP_MOV, 0, 0, 0, 0)); // pad 11

  // L0 = 12
  if (opts.storeR9ToR2) {
    words[L0] = armLdrImm(9, 2, 0, 0); // STR R9, [R2]
    words[L0 + 1] = armBx(14);
  } else if (opts.writeOutput) {
    // LDR R4,[SP]; LDR R5,[SP,#4]; STR R2,[R4]; STR R3,[R5]; MOV R0,#0; BX LR
    words[L0] = armLdrImm(4, 13, 0, 1);
    words[L0 + 1] = armLdrImm(5, 13, 4, 1);
    words[L0 + 2] = armLdrImm(2, 4, 0, 0);
    words[L0 + 3] = armLdrImm(3, 5, 0, 0);
    words[L0 + 4] = armDpImm(OP_MOV, 0, 0, 0, 0);
    words[L0 + 5] = armBx(14);
  } else {
    words[L0] = armDpImm(OP_MOV, 0, 0, 0, ret0 & 0xff);
    words[L0 + 1] = armBx(14);
  }

  words[L1] = armDpImm(OP_MOV, 0, 0, 0, ret1 & 0xff);
  words[L1 + 1] = armBx(14);

  if (opts.childLoad !== undefined) {
    const lit = 30;
    words[L6] = armDpReg(OP_MOV, 0, 0, 5, 14);
    words[L6 + 1] = armLdrImm(4, 15, (pcOf(lit) - (pcOf(L6 + 1) + 8)) & 0xfff);
    words[L6 + 2] = armBlx(4);
    words[L6 + 3] = armDpImm(OP_MOV, 0, 0, 0, ret6 & 0xff);
    words[L6 + 4] = armBx(5);
    words[lit] = opts.childLoad >>> 0;
  } else {
    words[L6] = armDpImm(OP_MOV, 0, 0, 0, ret6 & 0xff);
    words[L6 + 1] = armBx(14);
  }

  words[L8] = armDpImm(OP_MOV, 0, 0, 0, ret8 & 0xff);
  words[L8 + 1] = armBx(14);

  words[Ldef] = armDpImm(OP_MOV, 0, 0, 0, 0);
  words[Ldef + 1] = armBx(14);

  if (opts.addR0R1) {
    return [armDpRegAdd(), armBx(14)];
  }
  if (opts.storeR9ToRw) {
    return [armLdrImm(9, 9, 0, 0), armBx(14)];
  }
  return words.slice(0, 32);
}

function armDpRegAdd(): number {
  // ADD R0, R0, R1
  return (
    (0xe << 28) |
    (OP_ADD << 21) |
    (0 << 16) |
    (0 << 12) |
    1
  ) >>> 0;
}

/** Direct table-call snippet: set r0/r1, BLX table[n], BX LR. */
export function buildArmTableCaller(opts: { dest: number; slot: number; r0: number; r1: number }): Uint8Array {
  const dest = opts.dest >>> 0;
  const words = [
    armDpReg(OP_MOV, 0, 0, 6, 14),
    armDpImm(OP_MOV, 0, 0, 0, opts.r0 & 0xff),
    armDpImm(OP_MOV, 0, 0, 1, opts.r1 & 0xff),
    armLdrImm(4, 15, 4),
    armBlx(4),
    armBx(6),
    tableSlotAddr(opts.slot),
  ];
  // inst3 dest+12, PC+8=dest+20, imm4 → dest+24 = words[6]
  void dest;
  return wordsToBytes(words);
}

export function buildThumbTableCaller(opts: { dest: number; slot: number; r0: number; r1: number }): Uint8Array {
  const dest = opts.dest >>> 0;
  const halfs = [
    0x4676,
    thumbMovImm(0, opts.r0 & 0xff),
    thumbMovImm(1, opts.r1 & 0xff),
    thumbLdrPc(4, 2),
    thumbBlx(4),
    thumbBx(6),
    0,
    0,
  ];
  const bytes = concatBytes(halfsToBytes(halfs), le32(tableSlotAddr(opts.slot)));
  void dest;
  return bytes;
}

export function buildThumbLoadImage(opts: { dest?: number; helperHalfs: number[] }): Uint8Array {
  const dest = (opts.dest ?? EXT_CODE_ADDR) >>> 0;
  const helper = dest + THUMB_LOAD_HELPER_OFF;
  const helperAddr = helper | 1;
  const halfs: number[] = [
    0, 0, 0, 0,
    0x4676,
    thumbLdrPc(0, 3),
    thumbLdrPc(1, 3),
    thumbLdrPc(2, 4),
    thumbBlx(2),
    thumbMovImm(0, 0),
    thumbBx(6),
    0,
  ];
  const head = halfsToBytes(halfs);
  const lit = new Uint8Array(12);
  lit.set(le32(helperAddr), 0);
  lit.set(le32(20), 4);
  lit.set(le32(tableSlotAddr(25)), 8);
  return concatBytes(head, lit, halfsToBytes(opts.helperHalfs));
}

export function buildThumbCodeHelper(opts: { ret0?: number; ret1?: number; ret6?: number; ret8?: number }): number[] {
  const r0 = opts.ret0 ?? 0x10;
  const r1 = opts.ret1 ?? 0x11;
  const r6 = opts.ret6 ?? 0x16;
  const r8 = opts.ret8 ?? 0x18;
  // cmp r1, #imm is 0x2800 | (rd<<8) wait CMP Rn, #imm8 = 0x2800 | (rn<<8) | imm
  const cmpR1 = (imm: number) => (0x2800 | (1 << 8) | (imm & 0xff)) & 0xffff;
  const beq = (from: number, to: number) => {
    // Bcond: 0xD000 | (cond<<8) | simm8, offset = (to-(from+4))/2
    const off = ((to - (from + 4)) >> 1) & 0xff;
    return (0xd000 | (EQ << 8) | off) & 0xffff;
  };
  // We'll lay out at offset 0 of helper; branches are helper-relative.
  // 0: cmp #0; 2: beq L0; 4: cmp #1; 6: beq L1; 8: cmp #6; 10: beq L6; 12: cmp #8; 14: beq L8
  // 16: movs r0,#0; 18: bx lr
  // L0=20, L1=24, L6=28, L8=32
  const L0 = 20,
    L1 = 24,
    L6 = 28,
    L8 = 32;
  return [
    cmpR1(0),
    beq(2, L0),
    cmpR1(1),
    beq(6, L1),
    cmpR1(6),
    beq(10, L6),
    cmpR1(8),
    beq(14, L8),
    thumbMovImm(0, 0),
    thumbBx(14),
    thumbMovImm(0, r0),
    thumbBx(14),
    thumbMovImm(0, r1),
    thumbBx(14),
    thumbMovImm(0, r6),
    thumbBx(14),
    thumbMovImm(0, r8),
    thumbBx(14),
  ];
}

export function buildMinimalElf32(payload: Uint8Array, entry = 8): Uint8Array {
  const ehsize = 52;
  const phentsize = 32;
  const phoff = 52;
  const offset = ehsize + phentsize;
  const out = new Uint8Array(offset + payload.length);
  out[0] = 0x7f;
  out[1] = 0x45;
  out[2] = 0x4c;
  out[3] = 0x46;
  out[4] = 1;
  out[5] = 1;
  out[6] = 1;
  out[16] = 2;
  out[17] = 0; // ET_EXEC
  out[18] = 40;
  out[19] = 0; // EM_ARM
  out[20] = 1;
  writeU32(out, 24, entry);
  writeU32(out, 28, phoff);
  writeU16(out, 40, ehsize);
  writeU16(out, 42, phentsize);
  writeU16(out, 44, 1);
  writeU32(out, 52, 1); // PT_LOAD
  writeU32(out, 56, offset);
  writeU32(out, 60, 0); // vaddr
  writeU32(out, 64, 0);
  writeU32(out, 68, payload.length);
  writeU32(out, 72, payload.length);
  writeU32(out, 76, 5);
  writeU32(out, 80, 4);
  out.set(payload, offset);
  return out;
}

function writeU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
  b[o + 2] = v >>> 16;
  b[o + 3] = v >>> 24;
}

export { EXT_TABLE_ADDR };
