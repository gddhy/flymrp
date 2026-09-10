import { describe, expect, it } from "vitest";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  LuaVM,
  OP_ADD,
  OP_CALL,
  OP_CLOSURE,
  OP_GETGLOBAL,
  OP_GETUPVAL,
  OP_JMP,
  OP_LE,
  OP_LOADK,
  OP_LT,
  OP_MOVE,
  OP_MUL,
  OP_RETURN,
  OP_SETGLOBAL,
  OP_SETUPVAL,
  OP_SUB,
  call,
  proto,
} from "../../src/lua/index.ts";
import { kn, ks, resultNum } from "../helpers/lua.ts";

describe("5-C closure / upvalue", () => {
  it("captures local", () => {
    const child = proto({
      maxstack: 2,
      nups: 1,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 4,
        k: [kn(41)],
        p: [child],
        code: [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_CALL, 1, 1, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(41);
  });

  it("nested closure", () => {
    const inner = proto({
      maxstack: 2,
      nups: 1,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const mid = proto({
      maxstack: 3,
      nups: 1,
      p: [inner],
      code: [CREATE_ABx(OP_CLOSURE, 0, 0), CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 4,
        k: [kn(5)],
        p: [mid],
        code: [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_CALL, 1, 1, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(5);
  });

  it("multiple closures share upvalue", () => {
    const inc = proto({
      maxstack: 2,
      nups: 1,
      k: [kn(1)],
      code: [
        CREATE_ABC(OP_GETUPVAL, 0, 0, 0),
        CREATE_ABC(OP_ADD, 0, 0, 250),
        CREATE_ABC(OP_SETUPVAL, 0, 0, 0),
        CREATE_ABC(OP_RETURN, 0, 2, 0),
      ],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 8,
        k: [kn(10)],
        p: [inc],
        code: [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABx(OP_CLOSURE, 2, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_MOVE, 5, 2, 0),
          CREATE_ABC(OP_CALL, 1, 1, 1),
          CREATE_ABC(OP_CALL, 5, 1, 2),
          CREATE_ABC(OP_RETURN, 5, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(12);
  });

  it("closure after parent return", () => {
    const child = proto({
      maxstack: 2,
      nups: 1,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const maker = proto({
      maxstack: 3,
      k: [kn(77)],
      p: [child],
      code: [
        CREATE_ABx(OP_LOADK, 0, 0),
        CREATE_ABx(OP_CLOSURE, 1, 0),
        CREATE_ABC(OP_MOVE, 0, 0, 0),
        CREATE_ABC(OP_RETURN, 1, 2, 0),
      ],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 4,
        p: [maker],
        code: [
          CREATE_ABx(OP_CLOSURE, 0, 0),
          CREATE_ABC(OP_CALL, 0, 1, 2),
          CREATE_ABC(OP_CALL, 0, 1, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(77);
  });

  it("recursive Lua via global", () => {
    const body = proto({
      maxstack: 6,
      numparams: 1,
      k: [kn(0), kn(1), ks("sum")],
      code: [
        CREATE_ABC(OP_LE, 0, 0, 250),
        CREATE_AsBx(OP_JMP, 0, 2),
        CREATE_ABx(OP_LOADK, 0, 0),
        CREATE_ABC(OP_RETURN, 0, 2, 0),
        CREATE_ABx(OP_GETGLOBAL, 1, 2),
        CREATE_ABC(OP_SUB, 2, 0, 251),
        CREATE_ABC(OP_CALL, 1, 2, 2),
        CREATE_ABC(OP_ADD, 0, 0, 1),
        CREATE_ABC(OP_RETURN, 0, 2, 0),
      ],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 5,
        k: [ks("sum"), kn(4)],
        p: [body],
        code: [
          CREATE_ABx(OP_CLOSURE, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 0),
          CREATE_ABx(OP_SETGLOBAL, 0, 0),
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABC(OP_CALL, 0, 2, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(10);
  });

  it("mutual recursion natives", () => {
    const vm = new LuaVM();
    vm.register("even", (L) => {
      const n = L.optNumber(1, 0) | 0;
      if (n === 0) {
        L.pushInteger(1);
        return 1;
      }
      const g = L.getGlobal("odd");
      const f = L.top;
      L.grow(2);
      L.setFn(f, g.num);
      L.setNum(f + 1, n - 1);
      L.top = f + 2;
      call(L, f, 1);
      return 1;
    });
    vm.register("odd", (L) => {
      const n = L.optNumber(1, 0) | 0;
      if (n === 0) {
        L.pushInteger(0);
        return 1;
      }
      const g = L.getGlobal("even");
      const f = L.top;
      L.grow(2);
      L.setFn(f, g.num);
      L.setNum(f + 1, n - 1);
      L.top = f + 2;
      call(L, f, 1);
      return 1;
    });
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("even"), kn(4), ks("odd"), kn(5)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABC(OP_CALL, 0, 2, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(1);
    vm.runCold(
      proto({
        maxstack: 4,
        k: [ks("odd"), kn(5)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      }),
    );
    expect(resultNum(vm)).toBe(1);
  });

  it("two upvalues", () => {
    const child = proto({
      maxstack: 3,
      nups: 2,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_GETUPVAL, 1, 1, 0), CREATE_ABC(OP_ADD, 0, 0, 1), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 5,
        k: [kn(3), kn(4)],
        p: [child],
        code: [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_CLOSURE, 2, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_MOVE, 1, 1, 0),
          CREATE_ABC(OP_CALL, 2, 1, 2),
          CREATE_ABC(OP_RETURN, 2, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(7);
  });

  it("write upvalue after close", () => {
    const child = proto({
      maxstack: 2,
      nups: 1,
      k: [kn(1)],
      code: [
        CREATE_ABC(OP_GETUPVAL, 0, 0, 0),
        CREATE_ABC(OP_ADD, 0, 0, 250),
        CREATE_ABC(OP_SETUPVAL, 0, 0, 0),
        CREATE_ABC(OP_RETURN, 0, 2, 0),
      ],
    });
    const maker = proto({
      maxstack: 3,
      k: [kn(1)],
      p: [child],
      code: [
        CREATE_ABx(OP_LOADK, 0, 0),
        CREATE_ABx(OP_CLOSURE, 1, 0),
        CREATE_ABC(OP_MOVE, 0, 0, 0),
        CREATE_ABC(OP_RETURN, 1, 2, 0),
      ],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 4,
        p: [maker],
        code: [
          CREATE_ABx(OP_CLOSURE, 0, 0),
          CREATE_ABC(OP_CALL, 0, 1, 2),
          CREATE_ABC(OP_CALL, 0, 1, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(2);
  });

  it("ownership is LuaState arrays not JS timing", () => {
    const vm = new LuaVM();
    const beforeC = vm.L.stats.closures;
    const beforeU = vm.L.stats.upvals;
    const child = proto({
      maxstack: 2,
      nups: 1,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    vm.runCold(
      proto({
        maxstack: 4,
        k: [kn(1)],
        p: [child],
        code: [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
      }),
    );
    expect(vm.L.closures.length).toBeGreaterThan(1);
    expect(vm.L.stats.closures).toBeGreaterThan(beforeC);
    expect(vm.L.stats.upvals).toBeGreaterThan(beforeU);
  });

  it("open upvalue sees later writes", () => {
    const peek = proto({
      maxstack: 2,
      nups: 1,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = new LuaVM();
    vm.runCold(
      proto({
        maxstack: 5,
        k: [kn(1), kn(9)],
        p: [peek],
        code: [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABx(OP_LOADK, 0, 1),
          CREATE_ABC(OP_CALL, 1, 1, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(resultNum(vm)).toBe(9);
  });
});
