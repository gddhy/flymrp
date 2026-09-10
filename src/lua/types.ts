/** rxgj `mr.h` + `mr_user_number.h` (USE_INT → mrp_Number is int). */

export const TAG_NIL = 0;
export const TAG_BOOL = 1;
export const TAG_LIGHT = 2;
export const TAG_NUMBER = 3;
export const TAG_STRING = 4;
export const TAG_TABLE = 5;
export const TAG_FUNCTION = 6;
export const TAG_USERDATA = 7;
export const TAG_THREAD = 8;

export const MRP_SIGNATURE = "\x1bMRP";
export const VERSION_50 = 0x50;
export const VERSION_MAX = 0x80;
export const TEST_NUMBER = 31415926; // (int)3.14159265358979323846E7
export const SIZEOF_INT = 4;
export const SIZEOF_SIZET = 4;
export const SIZEOF_INSN = 4;
export const SIZEOF_NUMBER = 4;
export const MRP_MINSTACK = 20;
export const MRP_MAXCCALLS = 200;
export const MRP_MULTRET = -1;

export type ColdConst =
  | { t: typeof TAG_NIL }
  | { t: typeof TAG_NUMBER; n: number }
  | { t: typeof TAG_STRING; s: string };

export type ColdLocVar = { name: string | null; startpc: number; endpc: number };

export type ColdProto = {
  source: string | null;
  lineDefined: number;
  nups: number;
  numparams: number;
  isVararg: number;
  maxstack: number;
  lineinfo: number[];
  locvars: ColdLocVar[];
  upvalueNames: (string | null)[];
  k: ColdConst[];
  p: ColdProto[];
  /** Load-time only; VM copies into Uint32Array. */
  code: number[];
};

export type Proto = {
  source: string | null;
  lineDefined: number;
  nups: number;
  numparams: number;
  isVararg: number;
  maxstack: number;
  lineinfo: Int32Array;
  locvars: ColdLocVar[];
  upvalueNames: (string | null)[];
  kTags: Uint8Array;
  kNums: Int32Array;
  p: Proto[];
  code: Uint32Array;
};

export type NativeFunction = (L: import("./state.ts").LuaState) => number;

export type UpVal = {
  open: boolean;
  slot: number;
  tag: number;
  num: number;
};

export type LClosure = {
  isC: false;
  proto: Proto;
  upvals: UpVal[];
  g: number;
};

export type CClosure = {
  isC: true;
  fn: NativeFunction;
  nativeId: number;
  upvals: { tag: number; num: number }[];
};

export type Closure = LClosure | CClosure;

export type CallInfo = {
  base: number;
  top: number;
  pc: number;
  closure: number;
  isC: boolean;
  calling: boolean;
  savedpc: number;
  tailcalls: number;
};

export type Slot = { tag: number; num: number };
