import { describe, expect, it } from "vitest";
import { NativeAbiError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  LuaVM,
  NativeApi,
  OP_CALL,
  OP_GETGLOBAL,
  OP_LOADK,
  OP_RETURN,
  TAG_BOOL,
  TAG_NIL,
  TAG_NUMBER,
  TAG_STRING,
  proto,
} from "../../src/lua/index.ts";
import { kn, ks, resultNum, resultTag } from "../helpers/lua.ts";

describe("5-A-9 native ABI", () => {
  it("push integer", () => {
    const vm = new LuaVM();
    vm.register("f", (L) => {
      NativeApi.pushInteger(L, 11);
      return 1;
    });
    call0(vm, "f");
    expect(resultNum(vm)).toBe(11);
  });

  it("push number", () => {
    const vm = new LuaVM();
    vm.register("f", (L) => {
      NativeApi.pushNumber(L, -4);
      return 1;
    });
    call0(vm, "f");
    expect(resultNum(vm)).toBe(-4);
  });

  it("push string", () => {
    const vm = new LuaVM();
    vm.register("f", (L) => {
      NativeApi.pushString(L, "hi");
      return 1;
    });
    call0(vm, "f");
    expect(resultTag(vm)).toBe(TAG_STRING);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("hi");
  });

  it("push boolean", () => {
    const vm = new LuaVM();
    vm.register("f", (L) => {
      NativeApi.pushBoolean(L, true);
      return 1;
    });
    call0(vm, "f");
    expect(resultTag(vm)).toBe(TAG_BOOL);
    expect(resultNum(vm)).toBe(1);
  });

  it("push nil", () => {
    const vm = new LuaVM();
    vm.register("f", (L) => {
      NativeApi.pushNil(L);
      return 1;
    });
    call0(vm, "f");
    expect(resultTag(vm)).toBe(TAG_NIL);
  });

  it("get argument", () => {
    const vm = new LuaVM();
    vm.register("add", (L) => {
      NativeApi.pushInteger(L, NativeApi.toNumber(L, 1) + NativeApi.toNumber(L, 2));
      return 1;
    });
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("add"), kn(3), kn(9)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(12);
  });

  it("return values", () => {
    const vm = new LuaVM();
    vm.register("pair", (L) => {
      NativeApi.pushInteger(L, 1);
      NativeApi.pushInteger(L, 2);
      return 2;
    });
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("pair")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABC(OP_CALL, 0, 1, 3),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm, 0)).toBe(2);
  });

  it("missing required string", () => {
    const vm = new LuaVM();
    vm.register("need", (L) => {
      L.checkString(1);
      return 0;
    });
    expect(() => call0(vm, "need")).toThrow(NativeAbiError);
  });
});

function call0(vm: LuaVM, name: string): void {
  vm.runCold(
    proto({
      maxstack: 2,
      k: [ks(name)],
      code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    }),
  );
}
