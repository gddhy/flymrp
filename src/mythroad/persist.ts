import { LuaRuntimeError, NativeAbiError } from "../err/errors.ts";
import { LuaState } from "../lua/state.ts";
import {
  TAG_BOOL,
  TAG_FUNCTION,
  TAG_LIGHT,
  TAG_NIL,
  TAG_NUMBER,
  TAG_STRING,
  TAG_TABLE,
  TAG_THREAD,
  TAG_USERDATA,
} from "../lua/types.ts";

const PLUTO_TPERMANENT = 101;

/**
 * rxgj `mr_pluto.c` persist — little-endian ints, `mrp_Number = int`.
 * Literal nil / boolean / number / string / table only.
 */
export function persistRoot(L: LuaState, permsId: number, root: { tag: number; num: number }): Uint8Array {
  const w = new Writer();
  const refs = new Map<string, number>();
  persist(L, w, refs, permsId, root);
  return w.bytes();
}

export function unpersistRoot(L: LuaState, permsId: number, data: Uint8Array): { tag: number; num: number } {
  const r = new Reader(data);
  const byRef = new Map<number, { tag: number; num: number }>();
  return unpersist(L, r, byRef, permsId);
}

function ident(tag: number, num: number): string {
  return `${tag}:${num}`;
}

function persist(
  L: LuaState,
  w: Writer,
  refs: Map<string, number>,
  permsId: number,
  obj: { tag: number; num: number },
): void {
  if (obj.tag === TAG_NIL) {
    w.i32(0);
    w.i32(0);
    return;
  }
  const id = ident(obj.tag, obj.num);
  const seen = refs.get(id);
  if (seen !== undefined) {
    w.i32(0);
    w.i32(seen);
    return;
  }
  w.i32(1);
  const ref = refs.size + 1;
  refs.set(id, ref);
  w.i32(ref);

  const perm = L.tables[permsId]!.get(obj.tag, obj.num);
  if (perm.tag !== TAG_NIL) {
    w.i32(PLUTO_TPERMANENT);
    persist(L, w, refs, permsId, perm);
    return;
  }

  w.i32(obj.tag);
  switch (obj.tag) {
    case TAG_BOOL:
      w.i32(obj.num ? 1 : 0);
      break;
    case TAG_NUMBER:
      w.i32(obj.num);
      break;
    case TAG_STRING: {
      const s = L.strings[obj.num]!;
      w.i32(s.length);
      w.raw(s);
      break;
    }
    case TAG_TABLE:
      persistTable(L, w, refs, permsId, obj.num);
      break;
    case TAG_FUNCTION:
      throw new LuaRuntimeError("Attempt to persist a C function");
    case TAG_LIGHT:
    case TAG_USERDATA:
    case TAG_THREAD:
      throw new LuaRuntimeError("Type not literally persistable by default");
    default:
      throw new LuaRuntimeError(`persist: unknown type ${obj.tag}`);
  }
}

function persistTable(
  L: LuaState,
  w: Writer,
  refs: Map<string, number>,
  permsId: number,
  tid: number,
): void {
  const t = L.tables[tid]!;
  w.i32(0);
  if (t.meta) persist(L, w, refs, permsId, { tag: TAG_TABLE, num: t.meta });
  else persist(L, w, refs, permsId, { tag: TAG_NIL, num: 0 });
  let key: { tag: number; num: number } = { tag: TAG_NIL, num: 0 };
  for (;;) {
    const pair = t.next(key.tag, key.num);
    if (!pair) break;
    persist(L, w, refs, permsId, pair.k);
    persist(L, w, refs, permsId, pair.v);
    key = pair.k;
  }
  persist(L, w, refs, permsId, { tag: TAG_NIL, num: 0 });
}

function unpersist(
  L: LuaState,
  r: Reader,
  byRef: Map<number, { tag: number; num: number }>,
  permsId: number,
): { tag: number; num: number } {
  const first = r.i32();
  if (first === 0) {
    const ref = r.i32();
    if (ref === 0) return { tag: TAG_NIL, num: 0 };
    const hit = byRef.get(ref);
    if (!hit) throw new LuaRuntimeError("load/save table err!");
    return hit;
  }
  const ref = r.i32();
  const type = r.i32();
  if (type === PLUTO_TPERMANENT) {
    const key = unpersist(L, r, byRef, permsId);
    const obj = L.tables[permsId]!.get(key.tag, key.num);
    byRef.set(ref, obj);
    return obj;
  }
  let obj: { tag: number; num: number };
  switch (type) {
    case TAG_BOOL:
      obj = { tag: TAG_BOOL, num: r.i32() ? 1 : 0 };
      byRef.set(ref, obj);
      return obj;
    case TAG_NUMBER:
      obj = { tag: TAG_NUMBER, num: r.i32() };
      byRef.set(ref, obj);
      return obj;
    case TAG_STRING: {
      const n = r.i32();
      const s = r.str(n);
      obj = { tag: TAG_STRING, num: L.internStr(s) };
      byRef.set(ref, obj);
      return obj;
    }
    case TAG_TABLE:
      return unpersistTable(L, r, byRef, permsId, ref);
    default:
      throw new LuaRuntimeError(`unpersist: type ${type} not implemented`);
  }
}

function unpersistTable(
  L: LuaState,
  r: Reader,
  byRef: Map<number, { tag: number; num: number }>,
  permsId: number,
  ref: number,
): { tag: number; num: number } {
  const special = r.i32();
  if (special) throw new LuaRuntimeError("special table persist not implemented");
  const tid = L.newTable();
  const obj = { tag: TAG_TABLE, num: tid };
  byRef.set(ref, obj);
  const mt = unpersist(L, r, byRef, permsId);
  if (mt.tag === TAG_TABLE) L.tables[tid]!.meta = mt.num;
  for (;;) {
    const k = unpersist(L, r, byRef, permsId);
    if (k.tag === TAG_NIL) break;
    const v = unpersist(L, r, byRef, permsId);
    L.tables[tid]!.set(k.tag, k.num, v);
  }
  return obj;
}

class Writer {
  private readonly o: number[] = [];
  i32(n: number): void {
    const v = n | 0;
    this.o.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(s: string): void {
    for (let i = 0; i < s.length; i++) this.o.push(s.charCodeAt(i) & 0xff);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.o);
  }
}

class Reader {
  i = 0;
  constructor(readonly u8: Uint8Array) {}
  i32(): number {
    if (this.i + 4 > this.u8.length) throw new NativeAbiError("persist truncated");
    const v = this.u8[this.i]! | (this.u8[this.i + 1]! << 8) | (this.u8[this.i + 2]! << 16) | (this.u8[this.i + 3]! << 24);
    this.i += 4;
    return v | 0;
  }
  str(n: number): string {
    if (n < 0 || this.i + n > this.u8.length) throw new NativeAbiError("persist truncated");
    let s = "";
    for (let k = 0; k < n; k++) s += String.fromCharCode(this.u8[this.i + k]!);
    this.i += n;
    return s;
  }
}
