import { LuaChunkFormatError } from "../err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  SIZE_A,
  SIZE_B,
  SIZE_C,
  SIZE_OP,
} from "./opcodes.ts";
import {
  ColdConst,
  ColdProto,
  MRP_SIGNATURE,
  SIZEOF_INSN,
  SIZEOF_INT,
  SIZEOF_NUMBER,
  SIZEOF_SIZET,
  TAG_NIL,
  TAG_NUMBER,
  TAG_STRING,
  TEST_NUMBER,
  VERSION_50,
  VERSION_MAX,
} from "./types.ts";

class R {
  constructor(readonly u8: Uint8Array) {}
  i = 0;
  swap = false;

  rest(): number {
    return this.u8.length - this.i;
  }

  need(n: number): void {
    if (this.i + n > this.u8.length) throw new LuaChunkFormatError("unexpected end of Lua chunk");
  }

  u8b(): number {
    this.need(1);
    return this.u8[this.i++]!;
  }

  raw(n: number): Uint8Array {
    this.need(n);
    const s = this.u8.subarray(this.i, this.i + n);
    this.i += n;
    return s;
  }

  block(n: number): Uint8Array {
    const s = this.raw(n);
    if (!this.swap || n <= 1) return s;
    const o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = s[n - 1 - i]!;
    return o;
  }

  i32(): number {
    const v = this.s32();
    if (v < 0) throw new LuaChunkFormatError("bad integer in chunk");
    return v;
  }

  s32(): number {
    const b = this.block(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) | 0;
  }

  u32(): number {
    const b = this.block(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  number(): number {
    return this.s32();
  }

  str(): string | null {
    const size = this.u32();
    if (size === 0) return null;
    if (size > 0x1000000) throw new LuaChunkFormatError("string too large");
    const b = this.raw(size);
    const n = size > 0 && b[size - 1] === 0 ? size - 1 : size;
    const CHUNK = 0x2000;
    if (n <= CHUNK) return String.fromCharCode(...b.subarray(0, n));
    let s = "";
    for (let i = 0; i < n; i += CHUNK) s += String.fromCharCode(...b.subarray(i, Math.min(n, i + CHUNK)));
    return s;
  }
}

function loadFunction(r: R, parent: string | null): ColdProto {
  const src = r.str();
  const source = src ?? parent;
  const lineDefined = r.i32();
  const nups = r.u8b();
  const numparams = r.u8b();
  const isVararg = r.u8b();
  const maxstack = r.u8b();
  const nlines = r.i32();
  const lineinfo: number[] = [];
  for (let i = 0; i < nlines; i++) lineinfo.push(r.i32());
  const nloc = r.i32();
  const locvars = [];
  for (let i = 0; i < nloc; i++) {
    locvars.push({ name: r.str(), startpc: r.i32(), endpc: r.i32() });
  }
  const nupn = r.i32();
  if (nupn !== 0 && nupn !== nups) {
    throw new LuaChunkFormatError(`bad nupvalues: read ${nupn} expected ${nups}`);
  }
  const upvalueNames: (string | null)[] = [];
  for (let i = 0; i < nupn; i++) upvalueNames.push(r.str());
  const nk = r.i32();
  const k: ColdConst[] = [];
  for (let i = 0; i < nk; i++) {
    const t = r.u8b();
    if (t === TAG_NUMBER) k.push({ t, n: r.number() });
    else if (t === TAG_STRING) {
      const s = r.str();
      if (s === null) throw new LuaChunkFormatError("null string constant");
      k.push({ t, s });
    } else if (t === TAG_NIL) k.push({ t });
    else throw new LuaChunkFormatError(`bad constant type ${t}`);
  }
  const np = r.i32();
  const p: ColdProto[] = [];
  for (let i = 0; i < np; i++) p.push(loadFunction(r, source));
  const ncode = r.i32();
  const code: number[] = [];
  for (let i = 0; i < ncode; i++) {
    const b = r.block(4);
    code.push((b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0);
  }
  return {
    source,
    lineDefined,
    nups,
    numparams,
    isVararg,
    maxstack,
    lineinfo,
    locvars,
    upvalueNames,
    k,
    p,
    code,
  };
}

export class LuaChunkReader {
  static load(data: Uint8Array): ColdProto {
    const r = new R(data);
    for (let i = 0; i < 4; i++) {
      if (r.u8b() !== MRP_SIGNATURE.charCodeAt(i)) {
        throw new LuaChunkFormatError('bad signature (need "\\033MRP")');
      }
    }
    const version = r.u8b();
    if (version > VERSION_MAX || version < VERSION_50) {
      throw new LuaChunkFormatError(`unsupported chunk version 0x${version.toString(16)}`);
    }
    const endian = r.u8b();
    r.swap = endian !== 1;
    if (version <= VERSION_50) {
      const si = r.u8b();
      const ss = r.u8b();
      const sin = r.u8b();
      const sop = r.u8b();
      const sa = r.u8b();
      const sb = r.u8b();
      const sc = r.u8b();
      const sn = r.u8b();
      if (
        si !== SIZEOF_INT ||
        ss !== SIZEOF_SIZET ||
        sin !== SIZEOF_INSN ||
        sop !== SIZE_OP ||
        sa !== SIZE_A ||
        sb !== SIZE_B ||
        sc !== SIZE_C ||
        sn !== SIZEOF_NUMBER
      ) {
        throw new LuaChunkFormatError("virtual machine size mismatch");
      }
      const tn = r.number();
      if (tn !== TEST_NUMBER) throw new LuaChunkFormatError("unknown number format");
    }
    return loadFunction(r, null);
  }
}

class W {
  parts: Uint8Array[] = [];
  push(u: Uint8Array): void {
    this.parts.push(u);
  }
  u8(v: number): void {
    this.push(Uint8Array.of(v & 0xff));
  }
  i32(v: number): void {
    const x = v | 0;
    this.push(Uint8Array.of(x, x >>> 8, x >>> 16, x >>> 24));
  }
  u32(v: number): void {
    const x = v >>> 0;
    this.push(Uint8Array.of(x, x >>> 8, x >>> 16, x >>> 24));
  }
  str(s: string | null): void {
    if (s === null) {
      this.u32(0);
      return;
    }
    const n = s.length + 1;
    this.u32(n);
    const b = new Uint8Array(n);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    this.push(b);
  }
  finish(): Uint8Array {
    let n = 0;
    for (const p of this.parts) n += p.length;
    const o = new Uint8Array(n);
    let i = 0;
    for (const p of this.parts) {
      o.set(p, i);
      i += p.length;
    }
    return o;
  }
}

function dumpFunction(w: W, f: ColdProto, parent: string | null): void {
  w.str(f.source === parent ? null : f.source);
  w.i32(f.lineDefined);
  w.u8(f.nups);
  w.u8(f.numparams);
  w.u8(f.isVararg);
  w.u8(f.maxstack);
  w.i32(f.lineinfo.length);
  for (const x of f.lineinfo) w.i32(x);
  w.i32(f.locvars.length);
  for (const lv of f.locvars) {
    w.str(lv.name);
    w.i32(lv.startpc);
    w.i32(lv.endpc);
  }
  w.i32(f.upvalueNames.length);
  for (const n of f.upvalueNames) w.str(n);
  w.i32(f.k.length);
  for (const c of f.k) {
    w.u8(c.t);
    if (c.t === TAG_NUMBER) w.i32(c.n);
    else if (c.t === TAG_STRING) w.str(c.s);
  }
  w.i32(f.p.length);
  for (const ch of f.p) dumpFunction(w, ch, f.source);
  w.i32(f.code.length);
  for (const insn of f.code) w.u32(insn);
}

export type DumpOptions = { version?: number };

export function dumpChunk(main: ColdProto, opts: DumpOptions = {}): Uint8Array {
  const w = new W();
  for (let i = 0; i < 4; i++) w.u8(MRP_SIGNATURE.charCodeAt(i));
  const ver = opts.version ?? VERSION_MAX;
  w.u8(ver);
  w.u8(1);
  if (ver <= VERSION_50) {
    w.u8(SIZEOF_INT);
    w.u8(SIZEOF_SIZET);
    w.u8(SIZEOF_INSN);
    w.u8(SIZE_OP);
    w.u8(SIZE_A);
    w.u8(SIZE_B);
    w.u8(SIZE_C);
    w.u8(SIZEOF_NUMBER);
    w.i32(TEST_NUMBER);
  }
  dumpFunction(w, main, null);
  return w.finish();
}

export function proto(partial: Partial<ColdProto> & { code: number[] }): ColdProto {
  return {
    source: partial.source ?? "@chunk",
    lineDefined: partial.lineDefined ?? 0,
    nups: partial.nups ?? 0,
    numparams: partial.numparams ?? 0,
    isVararg: partial.isVararg ?? 0,
    maxstack: partial.maxstack ?? 8,
    lineinfo: partial.lineinfo ?? [],
    locvars: partial.locvars ?? [],
    upvalueNames: partial.upvalueNames ?? [],
    k: partial.k ?? [],
    p: partial.p ?? [],
    code: partial.code,
  };
}

export { CREATE_ABC, CREATE_ABx, CREATE_AsBx };
