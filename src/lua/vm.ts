import { LuaRuntimeError } from "../err/errors.ts";
import { dumpChunk, LuaChunkReader, proto as makeProto } from "./chunk.ts";
import {
  CREATE_ABC,
  fb2int,
  GET_OPCODE,
  GETARG_A,
  GETARG_B,
  GETARG_Bx,
  GETARG_C,
  GETARG_sBx,
  LFIELDS_PER_FLUSH,
  MAXSTACK,
  OP_ADD,
  OP_BAND,
  OP_BNOT,
  OP_BOR,
  OP_BXOR,
  OP_CALL,
  OP_CLOSE,
  OP_CLOSURE,
  OP_CONCAT,
  OP_DIV,
  OP_EQ,
  OP_FORLOOP,
  OP_GETGLOBAL,
  OP_GETTABLE,
  OP_GETUPVAL,
  OP_JMP,
  OP_LE,
  OP_LOADBOOL,
  OP_LOADK,
  OP_LOADNIL,
  OP_LT,
  OP_MOVE,
  OP_MUL,
  OP_NEWTABLE,
  OP_NOT,
  OP_POW,
  OP_RETURN,
  OP_SELF,
  OP_SETGLOBAL,
  OP_SETLIST,
  OP_SETLISTO,
  OP_SETTABLE,
  OP_SETUPVAL,
  OP_SUB,
  OP_TAILCALL,
  OP_TEST,
  OP_TFORLOOP,
  OP_TFORPREP,
  OP_UNM,
} from "./opcodes.ts";
import { i32, LuaState, parseIntStr } from "./state.ts";
import {
  ColdProto,
  MRP_MULTRET,
  NativeFunction,
  Proto,
  TAG_BOOL,
  TAG_FUNCTION,
  TAG_NIL,
  TAG_NUMBER,
  TAG_STRING,
  TAG_TABLE,
} from "./types.ts";

export function linkProto(L: LuaState, cold: ColdProto): Proto {
  const kTags = new Uint8Array(cold.k.length);
  const kNums = new Int32Array(cold.k.length);
  for (let i = 0; i < cold.k.length; i++) {
    const c = cold.k[i]!;
    kTags[i] = c.t;
    if (c.t === TAG_NUMBER) kNums[i] = c.n | 0;
    else if (c.t === TAG_STRING) kNums[i] = L.internStr(c.s);
    else kNums[i] = 0;
  }
  return {
    source: cold.source,
    lineDefined: cold.lineDefined,
    nups: cold.nups,
    numparams: cold.numparams,
    isVararg: cold.isVararg,
    maxstack: cold.maxstack,
    lineinfo: Int32Array.from(cold.lineinfo),
    locvars: cold.locvars,
    upvalueNames: cold.upvalueNames,
    kTags,
    kNums,
    p: cold.p.map((ch) => linkProto(L, ch)),
    code: Uint32Array.from(cold.code),
  };
}

function tostringAt(L: LuaState, i: number): string | null {
  const t = L.tags[i]!;
  if (t === TAG_STRING) return L.strings[L.nums[i]!]!;
  if (t === TAG_NUMBER) {
    const s = String(L.nums[i]!);
    L.setStr(i, L.internStr(s));
    return s;
  }
  return null;
}

function tonumberSlot(L: LuaState, tag: number, num: number): number | null {
  if (tag === TAG_NUMBER) return num | 0;
  if (tag === TAG_STRING) return parseIntStr(L.strings[num]!);
  return null;
}

function equalSlots(L: LuaState, ta: number, na: number, tb: number, nb: number): boolean {
  if (ta !== tb) return false;
  if (ta === TAG_NIL) return true;
  if (ta === TAG_NUMBER || ta === TAG_BOOL) return na === nb;
  if (ta === TAG_STRING || ta === TAG_TABLE || ta === TAG_FUNCTION) return na === nb;
  return na === nb;
}

function lessThan(L: LuaState, ta: number, na: number, tb: number, nb: number): boolean {
  if (ta !== tb) throw new LuaRuntimeError("attempt to compare different types");
  if (ta === TAG_NUMBER) return (na | 0) < (nb | 0);
  if (ta === TAG_STRING) return L.strings[na]! < L.strings[nb]!;
  throw new LuaRuntimeError("attempt to compare");
}

function lessEqual(L: LuaState, ta: number, na: number, tb: number, nb: number): boolean {
  if (ta !== tb) throw new LuaRuntimeError("attempt to compare different types");
  if (ta === TAG_NUMBER) return (na | 0) <= (nb | 0);
  if (ta === TAG_STRING) return L.strings[na]! <= L.strings[nb]!;
  throw new LuaRuntimeError("attempt to compare");
}

function rk(L: LuaState, base: number, proto: Proto, x: number): { tag: number; num: number } {
  if (x < MAXSTACK) return { tag: L.tags[base + x]!, num: L.nums[base + x]! };
  const i = x - MAXSTACK;
  return { tag: proto.kTags[i]!, num: proto.kNums[i]! };
}

function adjustVarargs(L: LuaState, nfix: number, firstArg: number): void {
  let actual = L.top - firstArg;
  while (actual < nfix) {
    L.grow(1);
    L.setNil(L.top++);
    actual++;
  }
  const extra = actual - nfix;
  const tid = L.newTable();
  const tab = L.tables[tid]!;
  for (let i = 0; i < extra; i++) {
    tab.setNum(i + 1, { tag: L.tags[L.top - extra + i]!, num: L.nums[L.top - extra + i]! });
  }
  tab.set(TAG_STRING, L.internStr("n"), { tag: TAG_NUMBER, num: extra | 0 });
  L.top -= extra;
  L.grow(1);
  L.setTbl(L.top++, tid);
}

function poscall(L: LuaState, wanted: number, firstResult: number): void {
  const res = L.base - 1;
  L.ci.pop();
  const prev = L.ci[L.ci.length - 1]!;
  L.base = prev.base;
  let w = wanted;
  let src = firstResult;
  let dst = res;
  while (w !== 0 && src < L.top) {
    L.copy(src++, dst++);
    w--;
  }
  while (w-- > 0) L.setNil(dst++);
  L.top = dst;
}

function precall(L: LuaState, func: number): number | null {
  if (L.tags[func] !== TAG_FUNCTION) throw new LuaRuntimeError("attempt to call a non-function");
  const cl = L.closures[L.nums[func]!]!;
  if (!cl.isC) {
    const p = cl.proto;
    if (p.isVararg) adjustVarargs(L, p.numparams, func + 1);
    L.checkstack(p.maxstack);
    const base = func + 1;
    const top = base + p.maxstack;
    L.ci.push({
      base,
      top,
      pc: 0,
      closure: L.nums[func]!,
      isC: false,
      calling: false,
      savedpc: 0,
      tailcalls: 0,
    });
    L.base = base;
    while (L.top < top) L.setNil(L.top++);
    L.top = top;
    return null;
  }
  L.checkstack(20);
  L.ci.push({
    base: func + 1,
    top: L.top + 20,
    pc: 0,
    closure: L.nums[func]!,
    isC: true,
    calling: false,
    savedpc: 0,
    tailcalls: 0,
  });
  L.base = func + 1;
  L.enterC();
  try {
    const n = cl.fn(L);
    return L.top - n;
  } finally {
    L.leaveC();
  }
}

function execute(L: LuaState): number {
  for (;;) {
    const ci = L.ci[L.ci.length - 1]!;
    const cl = L.closures[ci.closure]! as { isC: false; proto: Proto; upvals: import("./types.ts").UpVal[]; g: number };
    const proto = cl.proto;
    const code = proto.code;
    let pc = ci.pc;
    const base = ci.base;
    let restart = false;
    while (pc < code.length) {
      if (++L.insnCount > L.insnBudget) throw new LuaRuntimeError("instruction budget exceeded");
      const i = code[pc++]!;
      const op = GET_OPCODE(i);
      const a = GETARG_A(i);
      const ra = base + a;
      switch (op) {
        case OP_MOVE: {
          L.copy(base + GETARG_B(i), ra);
          break;
        }
        case OP_LOADK: {
          const bx = GETARG_Bx(i);
          L.tags[ra] = proto.kTags[bx]!;
          L.nums[ra] = proto.kNums[bx]!;
          break;
        }
        case OP_LOADBOOL: {
          L.setBool(ra, GETARG_B(i));
          if (GETARG_C(i)) pc++;
          break;
        }
        case OP_LOADNIL: {
          let rb = base + GETARG_B(i);
          do L.setNil(rb--);
          while (rb >= ra);
          break;
        }
        case OP_GETUPVAL: {
          const u = L.readUp(cl.upvals[GETARG_B(i)]!);
          L.tags[ra] = u.tag;
          L.nums[ra] = u.num;
          break;
        }
        case OP_GETGLOBAL: {
          const bx = GETARG_Bx(i);
          const v = L.tables[cl.g]!.getStr(proto.kNums[bx]!);
          L.tags[ra] = v.tag;
          L.nums[ra] = v.num;
          break;
        }
        case OP_GETTABLE: {
          const rb = base + GETARG_B(i);
          const kc = rk(L, base, proto, GETARG_C(i));
          if (L.tags[rb] !== TAG_TABLE) throw new LuaRuntimeError("attempt to index a non-table");
          const v = L.tables[L.nums[rb]!]!.get(kc.tag, kc.num);
          L.tags[ra] = v.tag;
          L.nums[ra] = v.num;
          break;
        }
        case OP_SETGLOBAL: {
          L.tables[cl.g]!.set(TAG_STRING, proto.kNums[GETARG_Bx(i)]!, L.slot(ra));
          break;
        }
        case OP_SETUPVAL: {
          L.writeUp(cl.upvals[GETARG_B(i)]!, L.tags[ra]!, L.nums[ra]!);
          break;
        }
        case OP_SETTABLE: {
          if (L.tags[ra] !== TAG_TABLE) throw new LuaRuntimeError("attempt to index a non-table");
          const kb = rk(L, base, proto, GETARG_B(i));
          const kc = rk(L, base, proto, GETARG_C(i));
          L.tables[L.nums[ra]!]!.set(kb.tag, kb.num, kc);
          break;
        }
        case OP_NEWTABLE: {
          const narray = fb2int(GETARG_B(i));
          const tid = L.newTable();
          if (narray > 0) {
            const t = L.tables[tid]!;
            for (let k = 0; k < narray; k++) t.arr.push({ tag: TAG_NIL, num: 0 });
          }
          L.setTbl(ra, tid);
          break;
        }
        case OP_SELF: {
          const rb = base + GETARG_B(i);
          const kc = rk(L, base, proto, GETARG_C(i));
          L.copy(rb, ra + 1);
          if (L.tags[rb] !== TAG_TABLE) throw new LuaRuntimeError("attempt to index a non-table");
          if (kc.tag !== TAG_STRING) throw new LuaRuntimeError("SELF key must be a string");
          const v = L.tables[L.nums[rb]!]!.get(kc.tag, kc.num);
          L.tags[ra] = v.tag;
          L.nums[ra] = v.num;
          break;
        }
        case OP_ADD:
        case OP_SUB:
        case OP_MUL:
        case OP_DIV: {
          const b = rk(L, base, proto, GETARG_B(i));
          const c = rk(L, base, proto, GETARG_C(i));
          const bn = tonumberSlot(L, b.tag, b.num);
          const cn = tonumberSlot(L, c.tag, c.num);
          if (bn === null || cn === null) throw new LuaRuntimeError("attempt to perform arithmetic");
          let r = 0;
          if (op === OP_ADD) r = i32(bn + cn);
          else if (op === OP_SUB) r = i32(bn - cn);
          else if (op === OP_MUL) r = i32(bn * cn);
          else {
            if (cn === 0) throw new LuaRuntimeError("division by zero");
            r = i32(bn / cn);
          }
          L.setNum(ra, r);
          break;
        }
        case OP_POW: {
          const pow = L.tables[cl.g]!.getStr(L.internStr("__pow"));
          if (pow.tag !== TAG_FUNCTION) throw new LuaRuntimeError("err:1020");
          const b = rk(L, base, proto, GETARG_B(i));
          const c = rk(L, base, proto, GETARG_C(i));
          const bn = tonumberSlot(L, b.tag, b.num);
          const cn = tonumberSlot(L, c.tag, c.num);
          if (bn === null || cn === null) throw new LuaRuntimeError("attempt to perform arithmetic");
          ci.pc = pc;
          L.grow(3);
          L.setFn(L.top, pow.num);
          L.setNum(L.top + 1, bn);
          L.setNum(L.top + 2, cn);
          L.top += 3;
          call(L, L.top - 3, 1);
          L.copy(L.top - 1, ra);
          L.top--;
          break;
        }
        case OP_UNM: {
          const rb = base + GETARG_B(i);
          const n = tonumberSlot(L, L.tags[rb]!, L.nums[rb]!);
          if (n === null) throw new LuaRuntimeError("attempt to perform arithmetic");
          L.setNum(ra, i32(-n));
          break;
        }
        case OP_NOT: {
          L.setBool(ra, L.isFalse(base + GETARG_B(i)) ? 1 : 0);
          break;
        }
        case OP_CONCAT: {
          const b = GETARG_B(i);
          const c = GETARG_C(i);
          let s = "";
          for (let r = b; r <= c; r++) {
            const part = tostringAt(L, base + r);
            if (part === null) throw new LuaRuntimeError("attempt to concatenate");
            s += part;
          }
          L.setStr(ra, L.internStr(s));
          break;
        }
        case OP_JMP: {
          pc += GETARG_sBx(i);
          break;
        }
        case OP_EQ: {
          const b = rk(L, base, proto, GETARG_B(i));
          const c = rk(L, base, proto, GETARG_C(i));
          if (equalSlots(L, b.tag, b.num, c.tag, c.num) !== (a !== 0)) pc++;
          else pc += GETARG_sBx(code[pc]!) + 1;
          break;
        }
        case OP_LT: {
          const b = rk(L, base, proto, GETARG_B(i));
          const c = rk(L, base, proto, GETARG_C(i));
          if (lessThan(L, b.tag, b.num, c.tag, c.num) !== (a !== 0)) pc++;
          else pc += GETARG_sBx(code[pc]!) + 1;
          break;
        }
        case OP_LE: {
          const b = rk(L, base, proto, GETARG_B(i));
          const c = rk(L, base, proto, GETARG_C(i));
          if (lessEqual(L, b.tag, b.num, c.tag, c.num) !== (a !== 0)) pc++;
          else pc += GETARG_sBx(code[pc]!) + 1;
          break;
        }
        case OP_TEST: {
          const rb = base + GETARG_B(i);
          if (L.isFalse(rb) === (GETARG_C(i) !== 0)) pc++;
          else {
            L.copy(rb, ra);
            pc += GETARG_sBx(code[pc]!) + 1;
          }
          break;
        }
        case OP_CALL:
        case OP_TAILCALL: {
          const b = GETARG_B(i);
          if (b !== 0) L.top = ra + b;
          const nresults = GETARG_C(i) - 1;
          ci.pc = pc;
          const first = precall(L, ra);
          if (first !== null) {
            poscall(L, nresults, first);
            if (nresults >= 0) L.top = L.ci[L.ci.length - 1]!.top;
          } else if (op === OP_CALL) {
            ci.calling = true;
            ci.savedpc = pc;
            ci.pc = pc;
          } else {
            const neu = L.ci[L.ci.length - 1]!;
            L.closeFrom(base);
            const src0 = ra;
            let aux = 0;
            while (src0 + aux < L.top) {
              L.copy(src0 + aux, base + aux - 1);
              aux++;
            }
            L.top = base + aux;
            ci.savedpc = neu.pc;
            ci.pc = neu.pc;
            ci.closure = L.nums[base - 1]!;
            ci.tailcalls++;
            L.ci.pop();
            L.base = ci.base;
            restart = true;
          }
          break;
        }
        case OP_RETURN: {
          const b = GETARG_B(i);
          if (b !== 0) L.top = ra + b - 1;
          L.closeFrom(base);
          ci.pc = pc;
          const prev = L.ci[L.ci.length - 2];
          if (!prev || !prev.calling) return ra;
          const callerCode = (L.closures[prev.closure] as { proto: Proto }).proto.code;
          const nresults = GETARG_C(callerCode[prev.savedpc - 1]!) - 1;
          poscall(L, nresults, ra);
          if (nresults >= 0) L.top = L.ci[L.ci.length - 1]!.top;
          L.ci[L.ci.length - 1]!.pc = prev.savedpc;
          L.ci[L.ci.length - 1]!.calling = false;
          break;
        }
        case OP_FORLOOP: {
          if (L.tags[ra] !== TAG_NUMBER) throw new LuaRuntimeError("err:1021");
          const lim = tonumberSlot(L, L.tags[ra + 1]!, L.nums[ra + 1]!);
          const step = tonumberSlot(L, L.tags[ra + 2]!, L.nums[ra + 2]!);
          if (lim === null) throw new LuaRuntimeError("err:1022");
          if (step === null) throw new LuaRuntimeError("err:1023");
          const idx = i32(L.nums[ra]! + step);
          if (step > 0 ? idx <= lim : idx >= lim) {
            pc += GETARG_sBx(i);
            L.setNum(ra, idx);
          }
          break;
        }
        case OP_TFORLOOP: {
          const nvar = GETARG_C(i) + 1;
          const cb = ra + nvar + 2;
          L.copy(ra, cb);
          L.copy(ra + 1, cb + 1);
          L.copy(ra + 2, cb + 2);
          L.top = cb + 3;
          ci.pc = pc;
          call(L, cb, nvar);
          L.top = ci.top;
          const dest = ra + 2;
          const src = dest + nvar;
          for (let n = nvar; n > 0; n--) L.copy(src + n - 1, dest + n - 1);
          if (L.tags[dest] === TAG_NIL) pc++;
          else pc += GETARG_sBx(code[pc]!) + 1;
          break;
        }
        case OP_TFORPREP: {
          if (L.tags[ra] === TAG_TABLE) {
            L.copy(ra, ra + 1);
            const nx = L.tables[cl.g]!.getStr(L.internStr("_next"));
            L.tags[ra] = nx.tag;
            L.nums[ra] = nx.num;
          }
          pc += GETARG_sBx(i);
          break;
        }
        case OP_SETLIST:
        case OP_SETLISTO: {
          if (L.tags[ra] !== TAG_TABLE) throw new LuaRuntimeError("SETLIST on non-table");
          const h = L.tables[L.nums[ra]!]!;
          let bc = GETARG_Bx(i);
          let n: number;
          if (op === OP_SETLIST) n = (bc & (LFIELDS_PER_FLUSH - 1)) + 1;
          else {
            n = L.top - ra - 1;
            L.top = ci.top;
          }
          bc &= ~(LFIELDS_PER_FLUSH - 1);
          for (; n > 0; n--) h.setNum(bc + n, L.slot(ra + n));
          break;
        }
        case OP_CLOSE: {
          L.closeFrom(ra);
          break;
        }
        case OP_CLOSURE: {
          const p = proto.p[GETARG_Bx(i)]!;
          const ncl = L.newLClosure(p, p.nups, cl.g);
          const nclo = L.closures[ncl]! as { isC: false; upvals: import("./types.ts").UpVal[] };
          for (let j = 0; j < p.nups; j++, pc++) {
            const ui = code[pc]!;
            if (GET_OPCODE(ui) === OP_GETUPVAL) nclo.upvals[j] = cl.upvals[GETARG_B(ui)]!;
            else nclo.upvals[j] = L.findUpval(base + GETARG_B(ui));
          }
          L.setFn(ra, ncl);
          break;
        }
        case OP_BNOT: {
          const b = rk(L, base, proto, GETARG_B(i));
          if (b.tag === TAG_NUMBER) L.setNum(ra, ~b.num);
          break;
        }
        case OP_BAND:
        case OP_BOR:
        case OP_BXOR: {
          const b = rk(L, base, proto, GETARG_B(i));
          const c = rk(L, base, proto, GETARG_C(i));
          if (b.tag === TAG_NUMBER && c.tag === TAG_NUMBER) {
            const r = op === OP_BAND ? b.num & c.num : op === OP_BOR ? b.num | c.num : b.num ^ c.num;
            L.setNum(ra, r);
          }
          break;
        }
        default:
          throw new LuaRuntimeError(`unsupported opcode ${op}`);
      }
      if (restart) break;
      if (L.ci[L.ci.length - 1] !== ci) {
        ci.pc = pc;
        break;
      }
    }
    if (L.ci[L.ci.length - 1] === ci && pc >= code.length) return base;
  }
}

export function call(L: LuaState, func: number, nresults: number): void {
  L.enterC();
  try {
    const first = precall(L, func);
    const fr = first === null ? execute(L) : first;
    poscall(L, nresults, fr);
  } finally {
    L.leaveC();
  }
}

export class LuaVM {
  readonly L: LuaState;
  constructor(L = new LuaState()) {
    this.L = L;
    this.L.register("next", nextFn);
    this.L.register("_next", nextFn);
  }

  register(name: string, fn: NativeFunction): void {
    this.L.register(name, fn);
  }

  loadCold(cold: ColdProto): number {
    this.L.top = 0;
    this.L.base = 1;
    this.L.ci.length = 1;
    this.L.ci[0]!.base = 1;
    this.L.ci[0]!.calling = false;
    const p = linkProto(this.L, cold);
    const id = this.L.newLClosure(p, p.nups, this.L.globalsId);
    this.L.grow(1);
    this.L.setFn(this.L.top++, id);
    return this.L.top - 1;
  }

  loadBytes(bytes: Uint8Array): number {
    return this.loadCold(LuaChunkReader.load(bytes));
  }

  pcall(nresults = MRP_MULTRET): void {
    const func = this.L.top - 1;
    call(this.L, func, nresults);
  }

  runCold(cold: ColdProto, nresults = MRP_MULTRET): void {
    this.loadCold(cold);
    this.pcall(nresults);
  }

  runBytes(bytes: Uint8Array, nresults = MRP_MULTRET): void {
    this.loadBytes(bytes);
    this.pcall(nresults);
  }

  /** Call a global Lua/C function at a runtime boundary (not per-opcode). */
  callGlobal(name: string, args: number[] = [], nresults = 0): boolean {
    const g = this.L.getGlobal(name);
    if (g.tag !== TAG_FUNCTION) return false;
    this.L.top = 0;
    this.L.base = 1;
    this.L.ci.length = 1;
    this.L.ci[0]!.base = 1;
    this.L.ci[0]!.calling = false;
    this.L.grow(1 + args.length);
    this.L.setFn(this.L.top++, g.num);
    for (const a of args) this.L.setNum(this.L.top++, a);
    call(this.L, 0, nresults);
    return true;
  }

  hasGlobalFn(name: string): boolean {
    return this.L.getGlobal(name).tag === TAG_FUNCTION;
  }

  /** Register slot after last pcall (1-based from current base, or absolute). */
  at(i: number): { tag: number; num: number } {
    return this.L.slot(i);
  }
}

function nextFn(L: LuaState): number {
  const t = L.checkTable(1);
  const keyi = L.absindex(2);
  const keyTag = keyi < L.top ? L.tags[keyi]! : TAG_NIL;
  const keyNum = keyi < L.top ? L.nums[keyi]! : 0;
  const pair = t.next(keyTag, keyNum);
  if (!pair) {
    L.pushNil();
    return 1;
  }
  L.grow(2);
  L.tags[L.top] = pair.k.tag;
  L.nums[L.top] = pair.k.num;
  L.tags[L.top + 1] = pair.v.tag;
  L.nums[L.top + 1] = pair.v.num;
  L.top += 2;
  return 2;
}

export { dumpChunk, LuaChunkReader, makeProto, CREATE_ABC };
