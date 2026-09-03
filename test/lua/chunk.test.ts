import { describe, expect, it } from "vitest";
import { LuaChunkFormatError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  LuaChunkReader,
  LuaVM,
  OP_ADD,
  OP_CALL,
  OP_CLOSURE,
  OP_EQ,
  OP_FORLOOP,
  OP_GETUPVAL,
  OP_JMP,
  OP_LOADK,
  OP_MOVE,
  OP_RETURN,
  OP_SUB,
  TAG_NUMBER,
  VERSION_50,
  dumpChunk,
  proto,
} from "../../src/lua/index.ts";
import { kn, ks, main, resultNum, runMain } from "../helpers/lua.ts";

describe("5-A-8 Lua chunk fixtures", () => {
  it("hand-built chunk (version 0x80)", () => {
    const bytes = dumpChunk(main([CREATE_ABx(OP_LOADK, 0, 0)], [kn(7)]));
    expect(bytes[0]).toBe(0x1b);
    expect(String.fromCharCode(bytes[1]!, bytes[2]!, bytes[3]!)).toBe("MRP");
    const cold = LuaChunkReader.load(bytes);
    expect(cold.k[0]).toEqual({ t: TAG_NUMBER, n: 7 });
    expect(resultNum(runMain(cold.code, cold.k))).toBe(7);
  });

  it("hand-built chunk (version 0x50 + TEST_NUMBER)", () => {
    const bytes = dumpChunk(main([CREATE_ABx(OP_LOADK, 0, 0)], [kn(-9)]), { version: VERSION_50 });
    expect(LuaChunkReader.load(bytes).k[0]).toEqual({ t: TAG_NUMBER, n: -9 });
  });

  it("arithmetic", () => {
    const vm = runMain(
      [CREATE_ABC(OP_ADD, 0, 250, 251)],
      [kn(20), kn(22)],
    );
    expect(resultNum(vm)).toBe(42);
  });

  it("branch", () => {
    const vm = runMain(
      [
        CREATE_ABC(OP_EQ, 1, 250, 251),
        CREATE_AsBx(OP_JMP, 0, 1),
        CREATE_ABx(OP_LOADK, 0, 2),
        CREATE_ABx(OP_LOADK, 0, 3),
      ],
      [kn(1), kn(1), kn(0), kn(99)],
    );
    expect(resultNum(vm)).toBe(99);
  });

  it("function call", () => {
    const child = proto({
      maxstack: 2,
      numparams: 1,
      k: [kn(1)],
      code: [CREATE_ABC(OP_ADD, 0, 0, 250), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = runMain(
      [
        CREATE_ABx(OP_CLOSURE, 0, 0),
        CREATE_ABx(OP_LOADK, 1, 0),
        CREATE_ABC(OP_CALL, 0, 2, 2),
      ],
      [kn(41)],
      { p: [child], maxstack: 4 },
    );
    expect(resultNum(vm)).toBe(42);
  });

  it("closure + upvalue", () => {
    const child = proto({
      maxstack: 2,
      nups: 1,
      code: [CREATE_ABC(OP_GETUPVAL, 0, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = runMain(
      [
        CREATE_ABx(OP_LOADK, 0, 0),
        CREATE_ABx(OP_CLOSURE, 1, 0),
        CREATE_ABC(OP_MOVE, 0, 0, 0),
        CREATE_ABC(OP_CALL, 1, 1, 2),
        CREATE_ABC(OP_RETURN, 1, 2, 0),
      ],
      [kn(77)],
      { p: [child], maxstack: 4 },
    );
    expect(resultNum(vm, 1)).toBe(77);
  });

  it("table", () => {
    const vm = runMain(
      [
        CREATE_ABC(10, 0, 0, 0), // NEWTABLE
        CREATE_ABx(OP_LOADK, 1, 0),
        CREATE_ABC(9, 0, 251, 1), // SETTABLE R0[K1]=R1  K1=2
        CREATE_ABC(6, 0, 0, 251), // GETTABLE R0=R0[K1]
      ],
      [kn(55), kn(2)],
    );
    expect(resultNum(vm)).toBe(55);
  });

  it("string", () => {
    const vm = runMain([CREATE_ABx(OP_LOADK, 0, 0)], [ks("mythroad")]);
    expect(vm.L.strings[vm.L.nums[0]!]!).toBe("mythroad");
  });

  it("loop", () => {
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
      [kn(1), kn(3), kn(1), kn(0)],
      { maxstack: 8 },
    );
    expect(resultNum(vm, 0)).toBe(6);
  });

  it("bitwise operations", () => {
    const vm = runMain(
      [CREATE_ABC(36, 0, 250, 251)],
      [kn(0x0c), kn(0x0a)],
    );
    expect(resultNum(vm)).toBe(0x08);
  });

  it("vararg", () => {
    const child = proto({
      maxstack: 4,
      numparams: 1,
      isVararg: 1,
      k: [ks("n")],
      code: [CREATE_ABC(6, 0, 1, 250), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const vm = runMain(
      [
        CREATE_ABx(OP_CLOSURE, 0, 0),
        CREATE_ABx(OP_LOADK, 1, 0),
        CREATE_ABx(OP_LOADK, 2, 1),
        CREATE_ABx(OP_LOADK, 3, 2),
        CREATE_ABC(OP_CALL, 0, 4, 2),
      ],
      [kn(10), kn(20), kn(30)],
      { p: [child], maxstack: 8 },
    );
    expect(resultNum(vm)).toBe(2);
  });

  it("return", () => {
    const vm = runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)], [kn(3)]);
    expect(resultNum(vm)).toBe(3);
  });

  it("nested prototype", () => {
    const inner = proto({
      maxstack: 2,
      k: [kn(9)],
      code: [CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const mid = proto({
      maxstack: 3,
      p: [inner],
      code: [CREATE_ABx(OP_CLOSURE, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 2, 0)],
    });
    const bytes = dumpChunk(
      proto({
        maxstack: 3,
        p: [mid],
        code: [CREATE_ABx(OP_CLOSURE, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 2, 0)],
      }),
    );
    const cold = LuaChunkReader.load(bytes);
    expect(cold.p.length).toBe(1);
    expect(cold.p[0]!.p.length).toBe(1);
    const vm = new LuaVM();
    vm.runBytes(bytes);
    expect(resultNum(vm)).toBe(9);
  });
});
