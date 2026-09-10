import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  LuaVM,
  OP_ADD,
  OP_CALL,
  OP_CONCAT,
  OP_EQ,
  OP_GETGLOBAL,
  OP_GETTABLE,
  OP_JMP,
  OP_LOADK,
  OP_LT,
  OP_NEWTABLE,
  OP_RETURN,
  OP_SETTABLE,
  TAG_FUNCTION,
  TAG_NIL,
  TAG_NUMBER,
  TAG_STRING,
  TAG_TABLE,
  LuaTable,
  call,
  proto,
} from "../../src/lua/index.ts";
import { kn, ks, resultNum, resultTag } from "../helpers/lua.ts";

function withMeta(vm: LuaVM, tId: number, name: string, fn: (L: import("../../src/lua/state.ts").LuaState) => number): number {
  const mt = vm.L.newTable();
  vm.L.tables[tId]!.meta = mt;
  vm.L.setTableFn(mt, name, fn);
  return mt;
}

describe("5-C table / metamethod", () => {
  it("raw table get/set", () => {
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("a"), kn(9)],
        code: [
          CREATE_ABC(OP_NEWTABLE, 0, 0, 0),
          CREATE_ABC(OP_SETTABLE, 0, 250, 251),
          CREATE_ABC(OP_GETTABLE, 1, 0, 250),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(9);
  });

  it("__index table via GETGLOBAL + GETTABLE", () => {
    const vm = new LuaVM();
    const protoT = vm.L.newTable();
    vm.L.tables[protoT]!.set(TAG_STRING, vm.L.internStr("x"), { tag: TAG_NUMBER, num: 42 });
    const t = vm.L.newTable();
    const mt = vm.L.newTable();
    vm.L.tables[t]!.meta = mt;
    vm.L.tables[mt]!.set(TAG_STRING, vm.L.internStr("__index"), { tag: TAG_TABLE, num: protoT });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), ks("x")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABC(OP_GETTABLE, 1, 0, 251),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(42);
  });

  it("__index function", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    withMeta(vm, t, "__index", (L) => {
      L.pushInteger(7);
      return 1;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), ks("miss")],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_GETTABLE, 1, 0, 251), CREATE_ABC(OP_RETURN, 1, 2, 0)],
      }),
    );
    expect(resultNum(vm)).toBe(7);
  });

  it("__newindex function", () => {
    const vm = new LuaVM();
    let seen = 0;
    const t = vm.L.newTable();
    withMeta(vm, t, "__newindex", (L) => {
      seen = L.optNumber(3, 0) | 0;
      return 0;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), ks("k"), kn(11)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_SETTABLE, 0, 251, 252), CREATE_ABC(OP_RETURN, 0, 1, 0)],
      }),
    );
    expect(seen).toBe(11);
    expect(vm.L.tables[t]!.get(TAG_STRING, vm.L.internStr("k")).tag).toBe(TAG_NIL);
  });

  it("__newindex table", () => {
    const vm = new LuaVM();
    const dest = vm.L.newTable();
    const t = vm.L.newTable();
    const mt = vm.L.newTable();
    vm.L.tables[t]!.meta = mt;
    vm.L.tables[mt]!.set(TAG_STRING, vm.L.internStr("__newindex"), { tag: TAG_TABLE, num: dest });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), ks("k"), kn(8)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_SETTABLE, 0, 251, 252), CREATE_ABC(OP_RETURN, 0, 1, 0)],
      }),
    );
    expect(vm.L.tables[dest]!.get(TAG_STRING, vm.L.internStr("k")).num).toBe(8);
  });

  it("existing key skips __newindex", () => {
    const vm = new LuaVM();
    let hits = 0;
    const t = vm.L.newTable();
    vm.L.tables[t]!.set(TAG_STRING, vm.L.internStr("k"), { tag: TAG_NUMBER, num: 1 });
    withMeta(vm, t, "__newindex", () => {
      hits++;
      return 0;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), ks("k"), kn(2)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_SETTABLE, 0, 251, 252), CREATE_ABC(OP_RETURN, 0, 1, 0)],
      }),
    );
    expect(hits).toBe(0);
    expect(vm.L.tables[t]!.get(TAG_STRING, vm.L.internStr("k")).num).toBe(2);
  });

  it("__call", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    withMeta(vm, t, "__call", (L) => {
      L.pushInteger((L.optNumber(2, 0) | 0) + 1);
      return 1;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), kn(4)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      }),
    );
    expect(resultNum(vm)).toBe(5);
  });

  it("__add", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    withMeta(vm, t, "__add", (L) => {
      L.pushInteger(100);
      return 1;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 3,
        k: [ks("obj"), kn(1)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_ADD, 1, 0, 251), CREATE_ABC(OP_RETURN, 1, 2, 0)],
      }),
    );
    expect(resultNum(vm)).toBe(100);
  });

  it("__concat", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    withMeta(vm, t, "__concat", (L) => {
      L.pushString("T+x");
      return 1;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("obj"), ks("x")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABC(OP_CONCAT, 2, 0, 1),
          CREATE_ABC(OP_RETURN, 2, 2, 0),
        ],
      }),
    );
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("T+x");
  });

  it("__eq same metamethod", () => {
    const vm = new LuaVM();
    const eq = vm.L.newCClosure((L) => {
      L.pushBoolean(true);
      return 1;
    });
    const t1 = vm.L.newTable();
    const t2 = vm.L.newTable();
    const mt = vm.L.newTable();
    vm.L.tables[t1]!.meta = mt;
    vm.L.tables[t2]!.meta = mt;
    vm.L.tables[mt]!.set(TAG_STRING, vm.L.internStr("__eq"), { tag: TAG_FUNCTION, num: eq });
    vm.L.setGlobal("a", TAG_TABLE, t1);
    vm.L.setGlobal("b", TAG_TABLE, t2);
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("a"), ks("b"), kn(1), kn(0)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_GETGLOBAL, 1, 1),
          CREATE_ABC(OP_EQ, 1, 0, 1),
          CREATE_AsBx(OP_JMP, 0, 1),
          CREATE_ABx(OP_LOADK, 2, 3),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_RETURN, 2, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(1);
  });

  it("__lt / __le", () => {
    const vm = new LuaVM();
    const t1 = vm.L.newTable();
    const t2 = vm.L.newTable();
    const mt = vm.L.newTable();
    vm.L.tables[t1]!.meta = mt;
    vm.L.tables[t2]!.meta = mt;
    vm.L.setTableFn(mt, "__lt", (L) => {
      L.pushBoolean(true);
      return 1;
    });
    vm.L.setGlobal("a", TAG_TABLE, t1);
    vm.L.setGlobal("b", TAG_TABLE, t2);
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("a"), ks("b"), kn(1)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_GETGLOBAL, 1, 1),
          CREATE_ABC(OP_LT, 1, 0, 1),
          CREATE_AsBx(OP_JMP, 0, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_RETURN, 2, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(1);
  });

  it("rawGet ignores __index", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    withMeta(vm, t, "__index", (L) => {
      L.pushInteger(99);
      return 1;
    });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    const raw = vm.L.getGlobal("table");
    expect(raw.tag).toBe(TAG_TABLE);
    vm.L.top = 0;
    vm.L.setFn(0, vm.L.tables[raw.num]!.getStr(vm.L.internStr("rawGet")).num);
    vm.L.top = 1;
    vm.L.setTbl(1, t);
    vm.L.top = 2;
    vm.L.pushString("x");
    call(vm.L, 0, 1);
    expect(resultTag(vm)).toBe(TAG_NIL);
  });

  it("getn counts array", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    vm.L.tables[t]!.setNum(1, { tag: TAG_NUMBER, num: 1 });
    vm.L.tables[t]!.setNum(2, { tag: TAG_NUMBER, num: 2 });
    vm.L.setGlobal("t", TAG_TABLE, t);
    const tab = vm.L.getGlobal("table");
    vm.L.top = 0;
    vm.L.setFn(0, vm.L.tables[tab.num]!.getStr(vm.L.internStr("getn")).num);
    vm.L.top = 1;
    vm.L.setTbl(1, t);
    vm.L.top = 2;
    call(vm.L, 0, 1);
    expect(resultNum(vm)).toBe(2);
  });

  it("insert / remove", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    vm.L.tables[t]!.setNum(1, { tag: TAG_NUMBER, num: 1 });
    const tab = vm.L.getGlobal("table");
    vm.L.top = 0;
    vm.L.setFn(0, vm.L.tables[tab.num]!.getStr(vm.L.internStr("insert")).num);
    vm.L.top = 1;
    vm.L.setTbl(1, t);
    vm.L.top = 2;
    vm.L.pushInteger(2);
    call(vm.L, 0, 0);
    expect(vm.L.tables[t]!.getNum(2).num).toBe(2);
    vm.L.top = 0;
    vm.L.setFn(0, vm.L.tables[tab.num]!.getStr(vm.L.internStr("remove")).num);
    vm.L.top = 1;
    vm.L.setTbl(1, t);
    vm.L.top = 2;
    vm.L.pushInteger(1);
    call(vm.L, 0, 1);
    expect(resultNum(vm)).toBe(1);
    expect(vm.L.tables[t]!.getn(vm.L.keyN)).toBe(1);
  });

  it("concat", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    vm.L.tables[t]!.setNum(1, { tag: TAG_STRING, num: vm.L.internStr("a") });
    vm.L.tables[t]!.setNum(2, { tag: TAG_STRING, num: vm.L.internStr("b") });
    const tab = vm.L.getGlobal("table");
    vm.L.top = 0;
    vm.L.setFn(0, vm.L.tables[tab.num]!.getStr(vm.L.internStr("concat")).num);
    vm.L.top = 1;
    vm.L.setTbl(1, t);
    vm.L.top = 2;
    vm.L.pushString("-");
    call(vm.L, 0, 1);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("a-b");
  });

  it("_setTab / _getTab", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    const mt = vm.L.newTable();
    vm.L.setGlobal("t", TAG_TABLE, t);
    vm.L.setGlobal("mt", TAG_TABLE, mt);
    vm.L.top = 0;
    const set = vm.L.getGlobal("_setTab");
    vm.L.setFn(0, set.num);
    vm.L.top = 1;
    vm.L.setTbl(1, t);
    vm.L.setTbl(2, mt);
    vm.L.top = 3;
    call(vm.L, 0, 1);
    expect(vm.L.tables[t]!.meta).toBe(mt);
  });

  it("loop in gettable errors 2014", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    const mt = vm.L.newTable();
    vm.L.tables[t]!.meta = mt;
    vm.L.tables[mt]!.set(TAG_STRING, vm.L.internStr("__index"), { tag: TAG_TABLE, num: t });
    vm.L.setGlobal("obj", TAG_TABLE, t);
    expect(() =>
      vm.runCold(
        proto({
          maxstack: 3,
          k: [ks("obj"), ks("z")],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_GETTABLE, 1, 0, 251), CREATE_ABC(OP_RETURN, 1, 2, 0)],
        }),
      ),
    ).toThrow(LuaRuntimeError);
  });

  it("JS object is not a Lua table", () => {
    const vm = new LuaVM();
    const id = vm.L.newTable();
    expect(vm.L.tables[id]).toBeInstanceOf(LuaTable);
    expect(Object.getPrototypeOf(vm.L.tables[id]!)).not.toBe(Object.prototype);
    expect(vm.L.tables[id]!.get).toBeTypeOf("function");
  });

  it("integer keys stay integers", () => {
    const vm = new LuaVM();
    const t = vm.L.newTable();
    vm.L.tables[t]!.setNum(1, { tag: TAG_NUMBER, num: 5 });
    expect(vm.L.tables[t]!.getNum(1).num).toBe(5);
    expect(vm.L.tables[t]!.get(TAG_STRING, vm.L.internStr("1")).tag).toBe(TAG_NIL);
  });

  it("__pow via globals still works", () => {
    const vm = new LuaVM();
    vm.register("__pow", (L) => {
      L.pushInteger(8);
      return 1;
    });
    vm.runCold(proto({ maxstack: 2, k: [kn(2), kn(3)], code: [CREATE_ABC(16, 0, 250, 251), CREATE_ABC(OP_RETURN, 0, 2, 0)] }));
    expect(resultNum(vm)).toBe(8);
  });
});
