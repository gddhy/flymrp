/** rxgj `mr_opcodes.h` — do not use stock Lua 5.1 numbering. */

export const OP_MOVE = 0;
export const OP_LOADK = 1;
export const OP_LOADBOOL = 2;
export const OP_LOADNIL = 3;
export const OP_GETUPVAL = 4;
export const OP_GETGLOBAL = 5;
export const OP_GETTABLE = 6;
export const OP_SETGLOBAL = 7;
export const OP_SETUPVAL = 8;
export const OP_SETTABLE = 9;
export const OP_NEWTABLE = 10;
export const OP_SELF = 11;
export const OP_ADD = 12;
export const OP_SUB = 13;
export const OP_MUL = 14;
export const OP_DIV = 15;
export const OP_POW = 16;
export const OP_UNM = 17;
export const OP_NOT = 18;
export const OP_CONCAT = 19;
export const OP_JMP = 20;
export const OP_EQ = 21;
export const OP_LT = 22;
export const OP_LE = 23;
export const OP_TEST = 24;
export const OP_CALL = 25;
export const OP_TAILCALL = 26;
export const OP_RETURN = 27;
export const OP_FORLOOP = 28;
export const OP_TFORLOOP = 29;
export const OP_TFORPREP = 30;
export const OP_SETLIST = 31;
export const OP_SETLISTO = 32;
export const OP_CLOSE = 33;
export const OP_CLOSURE = 34;
export const OP_BNOT = 35;
export const OP_BAND = 36;
export const OP_BOR = 37;
export const OP_BXOR = 38;

export const NUM_OPCODES = 39;
export const MAXSTACK = 250;
export const MAXARG_A = 255;
export const MAXARG_B = 511;
export const MAXARG_C = 511;
export const MAXARG_Bx = 0x3ffff;
export const MAXARG_sBx = 0x1ffff; // 131071
export const LFIELDS_PER_FLUSH = 32;
export const SIZE_OP = 6;
export const SIZE_A = 8;
export const SIZE_B = 9;
export const SIZE_C = 9;
export const POS_C = 6;
export const POS_B = 15;
export const POS_A = 24;

export const OP_NAMES = [
  "MOVE",
  "LOADK",
  "LOADBOOL",
  "LOADNIL",
  "GETUPVAL",
  "GETGLOBAL",
  "GETTABLE",
  "SETGLOBAL",
  "SETUPVAL",
  "SETTABLE",
  "NEWTABLE",
  "SELF",
  "ADD",
  "SUB",
  "MUL",
  "DIV",
  "POW",
  "UNM",
  "NOT",
  "CONCAT",
  "JMP",
  "EQ",
  "LT",
  "LE",
  "TEST",
  "CALL",
  "TAILCALL",
  "RETURN",
  "FORLOOP",
  "TFORLOOP",
  "TFORPREP",
  "SETLIST",
  "SETLISTO",
  "CLOSE",
  "CLOSURE",
  "BNOT",
  "BAND",
  "BOR",
  "BXOR",
] as const;

export function GET_OPCODE(i: number): number {
  return i & 0x3f;
}
export function GETARG_A(i: number): number {
  return (i >>> POS_A) & 0xff;
}
export function GETARG_B(i: number): number {
  return (i >>> POS_B) & 0x1ff;
}
export function GETARG_C(i: number): number {
  return (i >>> POS_C) & 0x1ff;
}
export function GETARG_Bx(i: number): number {
  return (i >>> POS_C) & 0x3ffff;
}
export function GETARG_sBx(i: number): number {
  return GETARG_Bx(i) - MAXARG_sBx;
}

export function CREATE_ABC(o: number, a: number, b: number, c: number): number {
  return (o | (a << POS_A) | (b << POS_B) | (c << POS_C)) >>> 0;
}
export function CREATE_ABx(o: number, a: number, bx: number): number {
  return (o | (a << POS_A) | (bx << POS_C)) >>> 0;
}
export function CREATE_AsBx(o: number, a: number, sbx: number): number {
  return CREATE_ABx(o, a, (sbx + MAXARG_sBx) >>> 0);
}

export function RK(x: number): number {
  return x < MAXSTACK ? x : x;
}
export function Kst(i: number): number {
  return MAXSTACK + i;
}

export function fb2int(x: number): number {
  return ((x & 7) << (x >>> 3)) | 0;
}
