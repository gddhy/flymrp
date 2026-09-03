import { LuaRuntimeError } from "../err/errors.ts";
import { TAG_BOOL, TAG_FUNCTION, TAG_LIGHT, TAG_NIL, TAG_NUMBER, TAG_STRING, TAG_TABLE, type Slot } from "./types.ts";

function keyOf(tag: number, num: number): string {
  if (tag === TAG_NUMBER) return `n:${num | 0}`;
  if (tag === TAG_STRING) return `s:${num}`;
  if (tag === TAG_BOOL) return `b:${num ? 1 : 0}`;
  if (tag === TAG_LIGHT) return `l:${num}`;
  if (tag === TAG_TABLE) return `t:${num}`;
  if (tag === TAG_FUNCTION) return `f:${num}`;
  return `x:${tag}:${num}`;
}

export class LuaTable {
  arr: Slot[] = [];
  map = new Map<string, Slot>();
  mapKeys: { tag: number; num: number }[] = [];
  meta = 0;

  get(tag: number, num: number): Slot {
    if (tag === TAG_NUMBER) {
      const k = num | 0;
      if (k === num && k >= 1 && k <= this.arr.length) {
        return this.arr[k - 1] ?? { tag: TAG_NIL, num: 0 };
      }
    }
    return this.map.get(keyOf(tag, num)) ?? { tag: TAG_NIL, num: 0 };
  }

  getStr(id: number): Slot {
    return this.map.get(`s:${id}`) ?? { tag: TAG_NIL, num: 0 };
  }

  getNum(k: number): Slot {
    if (k >= 1 && k <= this.arr.length) return this.arr[k - 1] ?? { tag: TAG_NIL, num: 0 };
    return this.map.get(`n:${k | 0}`) ?? { tag: TAG_NIL, num: 0 };
  }

  set(tag: number, num: number, val: Slot): void {
    if (tag === TAG_NIL) throw new LuaRuntimeError("table index is nil");
    if (tag === TAG_NUMBER) {
      const k = num | 0;
      if (k === num && k >= 1) {
        while (this.arr.length < k) this.arr.push({ tag: TAG_NIL, num: 0 });
        this.arr[k - 1] = { tag: val.tag, num: val.num };
        return;
      }
    }
    const key = keyOf(tag, num);
    if (!this.map.has(key)) this.mapKeys.push({ tag, num });
    if (val.tag === TAG_NIL) this.map.delete(key);
    else this.map.set(key, { tag: val.tag, num: val.num });
  }

  setNum(k: number, val: Slot): void {
    this.set(TAG_NUMBER, k | 0, val);
  }

  next(keyTag: number, keyNum: number): { k: Slot; v: Slot } | null {
    let start = 0;
    if (keyTag === TAG_NIL) start = 0;
    else if (keyTag === TAG_NUMBER && (keyNum | 0) === keyNum && keyNum >= 1 && keyNum <= this.arr.length) {
      start = keyNum;
    } else {
      start = this.arr.length;
      const want = keyOf(keyTag, keyNum);
      let found = false;
      for (let i = 0; i < this.mapKeys.length; i++) {
        const mk = this.mapKeys[i]!;
        if (keyOf(mk.tag, mk.num) === want) {
          start = this.arr.length + i + 1;
          found = true;
          break;
        }
      }
      if (!found) throw new LuaRuntimeError("invalid key for next");
    }
    for (let i = start; i < this.arr.length; i++) {
      const v = this.arr[i]!;
      if (v.tag !== TAG_NIL) return { k: { tag: TAG_NUMBER, num: i + 1 }, v };
    }
    const hashStart = Math.max(0, start - this.arr.length);
    for (let i = hashStart; i < this.mapKeys.length; i++) {
      const mk = this.mapKeys[i]!;
      const v = this.map.get(keyOf(mk.tag, mk.num));
      if (v && v.tag !== TAG_NIL) return { k: { tag: mk.tag, num: mk.num }, v };
    }
    return null;
  }
}
