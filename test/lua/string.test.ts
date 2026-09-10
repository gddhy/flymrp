import { describe, expect, it } from "vitest";
import { NativeAbiError } from "../../src/err/errors.ts";
import { LuaVM, TAG_NIL, TAG_NUMBER, TAG_STRING } from "../../src/lua/index.ts";
import { invokeField, resultNum, resultTag } from "../helpers/lua.ts";

function bin(bytes: number[]): string {
  return String.fromCharCode(...bytes);
}

describe("5-C string library", () => {
  it("len includes embedded zero", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "len", [bin([97, 0, 98])]);
    expect(resultNum(vm)).toBe(3);
  });

  it("len empty", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "len", [""]);
    expect(resultNum(vm)).toBe(0);
  });

  it("sub 1-based and negative", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "sub", ["abcdef", 2, 4]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("bcd");
    invokeField(vm, "string", "sub", ["abcdef", -2]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("ef");
  });

  it("sub empty range", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "sub", ["ab", 3, 1]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("");
  });

  it("byte high-bit and out of range", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "byte", [bin([0xff]), 1]);
    expect(resultNum(vm)).toBe(255);
    invokeField(vm, "string", "byte", ["a", 0], 1);
    expect(resultTag(vm)).toBe(TAG_NIL);
  });

  it("char builds binary", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "char", [65, 0, 255]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe(bin([65, 0, 255]));
  });

  it("char rejects >255", () => {
    const vm = new LuaVM();
    expect(() => invokeField(vm, "string", "char", [256])).toThrow(NativeAbiError);
  });

  it("rep / lower / upper", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "rep", ["ab", 3]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("ababab");
    invokeField(vm, "string", "lower", ["AbC"]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("abc");
    invokeField(vm, "string", "upper", ["AbC"]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("ABC");
  });

  it("find plain with embedded zero", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "find", [bin([1, 0, 2, 0, 3]), bin([2, 0, 3])], 2);
    expect(resultNum(vm, 0)).toBe(3);
    expect(resultNum(vm, 1)).toBe(5);
  });

  it("find miss is nil", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "find", ["abc", "z"]);
    expect(resultTag(vm)).toBe(TAG_NIL);
  });

  it("pack iii little-endian", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "pack", ["<iii", 1, 2, 3]);
    const s = vm.L.strings[vm.L.nums[0]!]!;
    expect(s.length).toBe(12);
    expect(s.charCodeAt(0)).toBe(1);
    expect(s.charCodeAt(4)).toBe(2);
  });

  it("pack/unpack big-endian and signed", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "pack", [">h", -2]);
    const s = vm.L.strings[vm.L.nums[0]!]!;
    expect(s.charCodeAt(0)).toBe(0xff);
    expect(s.charCodeAt(1)).toBe(0xfe);
    invokeField(vm, "string", "unpack", [">h", s], 2);
    expect(resultNum(vm, 0)).toBe(-2);
  });

  it("pack c pads short string", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "pack", ["c4", "ab"]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe(bin([97, 98, 0, 0]));
  });

  it("packLen of iii", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "packLen", ["iii"]);
    expect(resultNum(vm)).toBe(12);
  });

  it("subV returns 0 and length (host pointer limitation)", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "subV", ["hi"], 2);
    expect(resultNum(vm, 0)).toBe(0);
    expect(resultNum(vm, 1)).toBe(2);
  });

  it("clen stops at NUL", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "clen", [bin([65, 0, 66])]);
    expect(resultNum(vm)).toBe(1);
  });

  it("numeric conversion via concat path", () => {
    const vm = new LuaVM();
    invokeField(vm, "string", "rep", ["x", 2]);
    expect(resultTag(vm)).toBe(TAG_STRING);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("xx");
  });
});
