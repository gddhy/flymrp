import { NativeAbiError } from "../err/errors.ts";
import { LuaState } from "./state.ts";
import { TAG_BOOL, TAG_FUNCTION, TAG_NIL, TAG_NUMBER, TAG_STRING, TAG_TABLE } from "./types.ts";

/** Host-facing C ABI. Not an EXT table slot. */
export const NativeApi = {
  pushNil: (L: LuaState) => L.pushNil(),
  pushBoolean: (L: LuaState, b: boolean) => L.pushBoolean(b),
  pushInteger: (L: LuaState, n: number) => L.pushInteger(n),
  pushNumber: (L: LuaState, n: number) => L.pushNumber(n),
  pushString: (L: LuaState, s: string | Uint8Array) => L.pushString(s),
  getTop: (L: LuaState) => L.gettop(),
  setTop: (L: LuaState, n: number) => L.settop(n),
  type: (L: LuaState, idx: number): number => {
    const i = L.absindex(idx);
    if (i >= L.top || i < 0) return -1;
    return L.tags[i]!;
  },
  toNumber: (L: LuaState, idx: number): number => L.toNumber(L.absindex(idx)),
  toBoolean: (L: LuaState, idx: number): boolean => {
    const i = L.absindex(idx);
    if (i >= L.top) return false;
    return !L.isFalse(i);
  },
  toString: (L: LuaState, idx: number): string => {
    const i = L.absindex(idx);
    if (i >= L.top) return "";
    if (L.tags[i] === TAG_STRING) return L.strings[L.nums[i]!]!;
    if (L.tags[i] === TAG_NUMBER) return String(L.nums[i]!);
    throw new NativeAbiError("value is not a string");
  },
  isNil: (L: LuaState, idx: number): boolean => NativeApi.type(L, idx) === TAG_NIL,
  isNumber: (L: LuaState, idx: number): boolean => NativeApi.type(L, idx) === TAG_NUMBER,
  isString: (L: LuaState, idx: number): boolean => NativeApi.type(L, idx) === TAG_STRING,
  isBoolean: (L: LuaState, idx: number): boolean => NativeApi.type(L, idx) === TAG_BOOL,
  isTable: (L: LuaState, idx: number): boolean => NativeApi.type(L, idx) === TAG_TABLE,
  isFunction: (L: LuaState, idx: number): boolean => NativeApi.type(L, idx) === TAG_FUNCTION,
};

export type { NativeFunction } from "./types.ts";
