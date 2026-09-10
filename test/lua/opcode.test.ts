import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  LuaVM,
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
  TAG_BOOL,
  TAG_FUNCTION,
  TAG_NIL,
  TAG_NUMBER,
  TAG_STRING,
  TAG_TABLE,
  proto,
} from "../../src/lua/index.ts";
import { kn, ks, resultNum, resultTag, runMain } from "../helpers/lua.ts";

function ipow(L: import("../../src/lua/state.ts").LuaState): number {
  const a = L.toNumber(L.absindex(1));
  const b = L.toNumber(L.absindex(2));
  L.pushInteger(Math.pow(a, b) | 0);
  return 1;
}

describe("5-A-7 opcodes", () => {
  describe("MOVE", () => {
    it("semantic", () => {
      expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 1, 0), CREATE_ABC(OP_MOVE, 0, 1, 0)], [kn(5)]))).toBe(5);
    });
    it("edge self-move", () => {
      expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_MOVE, 0, 0, 0)], [kn(8)]))).toBe(8);
    });
    it("stack/register", () => {
      const vm = runMain([CREATE_ABx(OP_LOADK, 3, 0), CREATE_ABC(OP_MOVE, 7, 3, 0), CREATE_ABC(OP_RETURN, 7, 2, 0)], [kn(1)]);
      expect(resultNum(vm, 0)).toBe(1);
    });
  });

  describe("LOADK", () => {
    it("semantic", () => expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 0, 0)], [kn(42)]))).toBe(42));
    it("edge negative int", () => expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 0, 0)], [kn(-1)]))).toBe(-1));
    it("stack/register", () => {
      const vm = runMain([CREATE_ABx(OP_LOADK, 5, 1), CREATE_ABC(OP_RETURN, 5, 2, 0)], [kn(0), kn(9)]);
      expect(resultNum(vm, 0)).toBe(9);
    });
  });

  describe("LOADBOOL", () => {
    it("semantic", () => {
      const vm = runMain([CREATE_ABC(OP_LOADBOOL, 0, 1, 0)]);
      expect(resultTag(vm)).toBe(TAG_BOOL);
      expect(resultNum(vm)).toBe(1);
    });
    it("edge skip", () => {
      const vm = runMain([CREATE_ABC(OP_LOADBOOL, 0, 0, 1), CREATE_ABx(OP_LOADK, 0, 0)], [kn(99)]);
      expect(resultTag(vm)).toBe(TAG_BOOL);
    });
    it("stack/register", () => {
      const vm = runMain([CREATE_ABC(OP_LOADBOOL, 2, 1, 0), CREATE_ABC(OP_RETURN, 2, 2, 0)]);
      expect(resultNum(vm, 0)).toBe(1);
    });
  });

  describe("LOADNIL", () => {
    it("semantic", () => {
      const vm = runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_LOADNIL, 0, 0, 0)], [kn(1)]);
      expect(resultTag(vm)).toBe(TAG_NIL);
    });
    it("edge range", () => {
      const vm = runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABx(OP_LOADK, 1, 0), CREATE_ABC(OP_LOADNIL, 0, 1, 0)], [kn(1)]);
      expect(resultTag(vm, 0)).toBe(TAG_NIL);
      expect(resultTag(vm, 1)).toBe(TAG_NIL);
    });
    it("stack/register", () => {
      const vm = runMain([CREATE_ABx(OP_LOADK, 4, 0), CREATE_ABC(OP_LOADNIL, 4, 4, 0)], [kn(3)]);
      expect(resultTag(vm, 4)).toBe(TAG_NIL);
    });
  });

  describe("GETUPVAL / SETUPVAL", () => {
    const childGet = proto({
      nups: 1,
      maxstack: 2,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    it("semantic GETUPVAL", () => {
      const vm = runMain(
        [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_CALL, 1, 1, 2),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
        [kn(13)],
        { p: [childGet], maxstack: 4 },
      );
      expect(resultNum(vm, 1)).toBe(13);
    });
    it("edge SETUPVAL", () => {
      const childSet = proto({
        nups: 1,
        maxstack: 2,
        k: [kn(99)],
        code: [CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_SETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      });
      const vm = runMain(
        [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_CALL, 1, 1, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
        [kn(1)],
        { p: [childSet], maxstack: 4 },
      );
      expect(resultNum(vm, 0)).toBe(99);
    });
    it("stack/register", () => {
      expect(childGet.nups).toBe(1);
    });
  });

  describe("GETGLOBAL / SETGLOBAL", () => {
    it("semantic", () => {
      const vm = new LuaVM();
      vm.L.setGlobal("g", TAG_NUMBER, 21);
      vm.runCold(
        proto({
          maxstack: 2,
          k: [ks("g")],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
        }),
      );
      expect(resultNum(vm)).toBe(21);
    });
    it("edge missing → nil", () => {
      const vm = runMain([CREATE_ABx(OP_GETGLOBAL, 0, 0)], [ks("nope")]);
      expect(resultTag(vm)).toBe(TAG_NIL);
    });
    it("stack/register SETGLOBAL", () => {
      const vm = runMain([CREATE_ABx(OP_LOADK, 0, 1), CREATE_ABx(OP_SETGLOBAL, 0, 0)], [ks("x"), kn(8)]);
      expect(vm.L.getGlobal("x").num).toBe(8);
    });
  });

  describe("GETTABLE / SETTABLE", () => {
    it("semantic", () => {
      const vm = runMain(
        [
          CREATE_ABC(OP_NEWTABLE, 0, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 0),
          CREATE_ABC(OP_SETTABLE, 0, 251, 1),
          CREATE_ABC(OP_GETTABLE, 2, 0, 251),
          CREATE_ABC(OP_RETURN, 2, 2, 0),
        ],
        [kn(44), kn(1)],
      );
      expect(resultNum(vm, 2)).toBe(44);
    });
    it("edge missing key", () => {
      const vm = runMain(
        [CREATE_ABC(OP_NEWTABLE, 0, 0, 0), CREATE_ABC(OP_GETTABLE, 0, 0, 250)],
        [kn(3)],
      );
      expect(resultTag(vm)).toBe(TAG_NIL);
    });
    it("error non-table", () => {
      expect(() => runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_GETTABLE, 0, 0, 250)], [kn(1)])).toThrow(
        LuaRuntimeError,
      );
    });
  });

  describe("NEWTABLE", () => {
    it("semantic", () => {
      expect(resultTag(runMain([CREATE_ABC(OP_NEWTABLE, 0, 0, 0)]))).toBe(TAG_TABLE);
    });
    it("edge array hint", () => {
      const vm = runMain([CREATE_ABC(OP_NEWTABLE, 0, 2, 0)]);
      expect(vm.L.tables[vm.L.nums[0]!]!.arr.length).toBeGreaterThan(0);
    });
    it("stack/register", () => {
      const vm = runMain([CREATE_ABC(OP_NEWTABLE, 4, 0, 0), CREATE_ABC(OP_RETURN, 4, 2, 0)]);
      expect(resultTag(vm, 0)).toBe(TAG_TABLE);
    });
  });

  describe("SELF", () => {
    it("semantic", () => {
      const vm = runMain(
        [
          CREATE_ABC(OP_NEWTABLE, 0, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 0),
          CREATE_ABC(OP_SETTABLE, 0, 251, 1),
          CREATE_ABC(OP_SELF, 2, 0, 251),
          CREATE_ABC(OP_RETURN, 2, 2, 0),
        ],
        [kn(5), ks("m")],
      );
      expect(resultNum(vm, 0)).toBe(5);
    });
    it("edge missing method", () => {
      const vm = runMain(
        [CREATE_ABC(OP_NEWTABLE, 0, 0, 0), CREATE_ABC(OP_SELF, 1, 0, 250), CREATE_ABC(OP_RETURN, 1, 2, 0)],
        [ks("x")],
      );
      expect(resultTag(vm, 0)).toBe(TAG_NIL);
    });
    it("error non-table", () => {
      expect(() => runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_SELF, 1, 0, 251)], [kn(1), ks("m")])).toThrow(
        LuaRuntimeError,
      );
    });
  });

  describe("ADD SUB MUL DIV", () => {
    it("semantic ADD", () => expect(resultNum(runMain([CREATE_ABC(OP_ADD, 0, 250, 251)], [kn(2), kn(3)]))).toBe(5));
    it("semantic SUB/MUL/DIV", () => {
      expect(resultNum(runMain([CREATE_ABC(OP_SUB, 0, 250, 251)], [kn(9), kn(4)]))).toBe(5);
      expect(resultNum(runMain([CREATE_ABC(OP_MUL, 0, 250, 251)], [kn(6), kn(7)]))).toBe(42);
      expect(resultNum(runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(20), kn(4)]))).toBe(5);
    });
    it("edge int div toward zero", () => expect(resultNum(runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(-7), kn(2)]))).toBe(-3));
    it("error div0", () => {
      expect(() => runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(1), kn(0)])).toThrow(LuaRuntimeError);
    });
  });

  describe("POW", () => {
    it("semantic", () => {
      const vm = new LuaVM();
      vm.register("__pow", ipow);
      vm.runCold(proto({ maxstack: 2, k: [kn(2), kn(8)], code: [CREATE_ABC(OP_POW, 0, 250, 251), CREATE_ABC(OP_RETURN, 0, 2, 0)] }));
      expect(resultNum(vm)).toBe(256);
    });
    it("edge 2^-1 → 0 (int)", () => {
      const vm = new LuaVM();
      vm.register("__pow", ipow);
      vm.runCold(proto({ maxstack: 2, k: [kn(2), kn(-1)], code: [CREATE_ABC(OP_POW, 0, 250, 251), CREATE_ABC(OP_RETURN, 0, 2, 0)] }));
      expect(resultNum(vm)).toBe(0);
    });
    it("error without __pow", () => {
      expect(() => runMain([CREATE_ABC(OP_POW, 0, 250, 251)], [kn(2), kn(3)])).toThrow(LuaRuntimeError);
    });
  });

  describe("UNM NOT CONCAT", () => {
    it("semantic UNM", () =>
      expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 1, 0), CREATE_ABC(OP_UNM, 0, 1, 0)], [kn(5)]))).toBe(-5));
    it("semantic NOT", () => {
      const vm = runMain([CREATE_ABC(OP_LOADNIL, 1, 1, 0), CREATE_ABC(OP_NOT, 0, 1, 0)]);
      expect(resultTag(vm)).toBe(TAG_BOOL);
      expect(resultNum(vm)).toBe(1);
    });
    it("semantic CONCAT", () => {
      const vm = runMain(
        [CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CONCAT, 2, 0, 1), CREATE_ABC(OP_RETURN, 2, 2, 0)],
        [ks("ab"), ks("cd")],
      );
      expect(vm.L.strings[vm.L.nums[0]!]!).toBe("abcd");
    });
    it("error CONCAT", () => {
      expect(() =>
        runMain([CREATE_ABC(OP_NEWTABLE, 0, 0, 0), CREATE_ABx(OP_LOADK, 1, 0), CREATE_ABC(OP_CONCAT, 2, 0, 1)], [ks("x")]),
      ).toThrow(LuaRuntimeError);
    });
  });

  describe("JMP EQ LT LE TEST", () => {
    it("semantic JMP", () => {
      const vm = runMain([CREATE_AsBx(OP_JMP, 0, 1), CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABx(OP_LOADK, 0, 1)], [kn(1), kn(2)]);
      expect(resultNum(vm)).toBe(2);
    });
    it("semantic EQ", () => {
      const vm = runMain(
        [CREATE_ABC(OP_EQ, 1, 250, 251), CREATE_AsBx(OP_JMP, 0, 1), CREATE_ABx(OP_LOADK, 0, 2), CREATE_ABx(OP_LOADK, 0, 3)],
        [kn(4), kn(4), kn(0), kn(1)],
      );
      expect(resultNum(vm)).toBe(1);
    });
    it("semantic LT/LE", () => {
      expect(
        resultNum(
          runMain(
            [CREATE_ABC(OP_LT, 1, 250, 251), CREATE_AsBx(OP_JMP, 0, 1), CREATE_ABx(OP_LOADK, 0, 2), CREATE_ABx(OP_LOADK, 0, 3)],
            [kn(1), kn(2), kn(0), kn(1)],
          ),
        ),
      ).toBe(1);
      expect(
        resultNum(
          runMain(
            [CREATE_ABC(OP_LE, 1, 250, 251), CREATE_AsBx(OP_JMP, 0, 1), CREATE_ABx(OP_LOADK, 0, 2), CREATE_ABx(OP_LOADK, 0, 3)],
            [kn(2), kn(2), kn(0), kn(1)],
          ),
        ),
      ).toBe(1);
    });
    it("TEST truthy", () => {
      const vm = runMain(
        [
          CREATE_ABx(OP_LOADK, 1, 0),
          CREATE_ABC(OP_TEST, 0, 1, 1),
          CREATE_AsBx(OP_JMP, 0, 1),
          CREATE_ABx(OP_LOADK, 2, 1),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
        [kn(7), kn(0)],
      );
      expect(resultNum(vm)).toBe(7);
    });
    it("error compare types", () => {
      expect(() => runMain([CREATE_ABC(OP_LT, 1, 250, 251), CREATE_AsBx(OP_JMP, 0, 0)], [kn(1), ks("a")])).toThrow(
        LuaRuntimeError,
      );
    });
  });

  describe("CALL TAILCALL RETURN", () => {
    it("semantic CALL", () => {
      const child = proto({
        maxstack: 2,
        numparams: 2,
        code: [CREATE_ABC(OP_ADD, 0, 0, 1), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      });
      const vm = runMain(
        [
          CREATE_ABx(OP_CLOSURE, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 0),
          CREATE_ABx(OP_LOADK, 2, 1),
          CREATE_ABC(OP_CALL, 0, 3, 2),
        ],
        [kn(10), kn(32)],
        { p: [child], maxstack: 6 },
      );
      expect(resultNum(vm)).toBe(42);
    });
    it("semantic TAILCALL", () => {
      const leaf = proto({
        maxstack: 2,
        k: [kn(70)],
        code: [CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      });
      const mid = proto({
        maxstack: 3,
        p: [leaf],
        code: [CREATE_ABx(OP_CLOSURE, 0, 0), CREATE_ABC(OP_TAILCALL, 0, 1, 0), CREATE_ABC(OP_RETURN, 0, 0, 0)],
      });
      const vm = runMain(
        [CREATE_ABx(OP_CLOSURE, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2)],
        [],
        { p: [mid], maxstack: 4 },
      );
      expect(resultNum(vm)).toBe(70);
    });
    it("error call non-function", () => {
      expect(() => runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2)], [kn(1)])).toThrow(LuaRuntimeError);
    });
  });

  describe("FORLOOP TFORLOOP TFORPREP", () => {
    it("semantic FORLOOP", () => {
      const vm = runMain(
        [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABC(OP_SUB, 0, 0, 2),
          CREATE_AsBx(OP_JMP, 0, 1),
          CREATE_ABC(OP_ADD, 3, 3, 0),
          CREATE_AsBx(OP_FORLOOP, 0, -2),
          CREATE_ABC(OP_RETURN, 3, 2, 0),
        ],
        [kn(1), kn(4), kn(1), kn(0)],
      );
      expect(resultNum(vm, 0)).toBe(10);
    });
    it("error FORLOOP non-number", () => {
      expect(() =>
        runMain(
          [CREATE_ABC(OP_LOADNIL, 0, 2, 0), CREATE_AsBx(OP_FORLOOP, 0, 0)],
          [],
        ),
      ).toThrow(LuaRuntimeError);
    });
    it("semantic TFORPREP+TFORLOOP", () => {
      const vm = new LuaVM();
      vm.runCold(
        proto({
          maxstack: 12,
          k: [kn(1), kn(10)],
          code: [
            CREATE_ABC(OP_NEWTABLE, 3, 0, 0),
            CREATE_ABx(OP_LOADK, 4, 1),
            CREATE_ABC(OP_SETTABLE, 3, 250, 4),
            CREATE_ABC(OP_MOVE, 0, 3, 0),
            CREATE_AsBx(OP_TFORPREP, 0, 0),
            CREATE_ABC(OP_TFORLOOP, 0, 0, 1),
            CREATE_AsBx(OP_JMP, 0, 0),
            CREATE_ABC(OP_RETURN, 3, 2, 0),
          ],
        }),
      );
      expect(resultNum(vm, 0)).toBe(10);
    });
  });

  describe("SETLIST SETLISTO CLOSE CLOSURE", () => {
    it("semantic SETLIST", () => {
      const vm = runMain(
        [
          CREATE_ABC(OP_NEWTABLE, 0, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 0),
          CREATE_ABx(OP_LOADK, 2, 1),
          CREATE_ABx(OP_SETLIST, 0, 1),
          CREATE_ABC(OP_GETTABLE, 3, 0, 252),
          CREATE_ABC(OP_RETURN, 3, 2, 0),
        ],
        [kn(11), kn(22), kn(2)],
      );
      expect(resultNum(vm, 3)).toBe(22);
    });
    it("semantic SETLISTO", () => {
      const vm = new LuaVM();
      vm.register("vals", (L) => {
        L.pushInteger(3);
        L.pushInteger(4);
        return 2;
      });
      vm.runCold(
        proto({
          maxstack: 8,
          k: [ks("vals"), kn(2)],
          code: [
            CREATE_ABC(OP_NEWTABLE, 0, 0, 0),
            CREATE_ABx(OP_GETGLOBAL, 1, 0),
            CREATE_ABC(OP_CALL, 1, 1, 0),
            CREATE_ABx(OP_SETLISTO, 0, 0),
            CREATE_ABC(OP_GETTABLE, 5, 0, 251),
            CREATE_ABC(OP_RETURN, 5, 2, 0),
          ],
        }),
      );
      expect(resultNum(vm, 0)).toBe(4);
    });
    it("semantic CLOSE", () => {
      const child = proto({
        nups: 1,
        maxstack: 2,
        code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      });
      const vm = runMain(
        [
          CREATE_ABx(OP_LOADK, 0, 0),
          CREATE_ABx(OP_CLOSURE, 1, 0),
          CREATE_ABC(OP_MOVE, 0, 0, 0),
          CREATE_ABC(OP_CLOSE, 0, 0, 0),
          CREATE_ABx(OP_LOADK, 0, 1),
          CREATE_ABC(OP_CALL, 1, 1, 2),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
        [kn(5), kn(6)],
        { p: [child], maxstack: 4 },
      );
      expect(resultNum(vm, 0)).toBe(5);
    });
    it("stack CLOSURE is function", () => {
      const child = proto({ maxstack: 1, code: [CREATE_ABC(OP_RETURN, 0, 1, 0)] });
      const vm = runMain([CREATE_ABx(OP_CLOSURE, 0, 0)], [], { p: [child] });
      expect(resultTag(vm)).toBe(TAG_FUNCTION);
    });
  });

  describe("BNOT BAND BOR BXOR", () => {
    it("semantic BNOT", () => expect(resultNum(runMain([CREATE_ABC(OP_BNOT, 0, 250, 0)], [kn(0)]))).toBe(-1));
    it("semantic BAND/BOR/BXOR", () => {
      expect(resultNum(runMain([CREATE_ABC(OP_BAND, 0, 250, 251)], [kn(0x0c), kn(0x0a)]))).toBe(8);
      expect(resultNum(runMain([CREATE_ABC(OP_BOR, 0, 250, 251)], [kn(0x0c), kn(0x0a)]))).toBe(14);
      expect(resultNum(runMain([CREATE_ABC(OP_BXOR, 0, 250, 251)], [kn(0x0c), kn(0x0a)]))).toBe(6);
    });
    it("edge non-number is silent", () => {
      const vm = runMain([CREATE_ABC(OP_NEWTABLE, 1, 0, 0), CREATE_ABC(OP_BNOT, 0, 1, 0)]);
      expect(resultTag(vm)).toBe(TAG_NIL);
    });
    it("stack/register", () => {
      const vm = runMain([CREATE_ABC(OP_BAND, 4, 250, 251), CREATE_ABC(OP_RETURN, 4, 2, 0)], [kn(7), kn(3)]);
      expect(resultNum(vm, 0)).toBe(3);
    });
  });
});
