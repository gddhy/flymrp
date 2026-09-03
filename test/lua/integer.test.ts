import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  OP_ADD,
  OP_BAND,
  OP_BNOT,
  OP_DIV,
  OP_EQ,
  OP_JMP,
  OP_LE,
  OP_LOADK,
  OP_LT,
  OP_MUL,
  OP_RETURN,
  OP_SUB,
  OP_UNM,
} from "../../src/lua/index.ts";
import { kn, resultNum, runMain } from "../helpers/lua.ts";

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

describe("5-C integer semantics", () => {
  it("INT_MAX + 1 wraps", () => {
    expect(resultNum(runMain([CREATE_ABC(OP_ADD, 0, 250, 251)], [kn(INT_MAX), kn(1)]))).toBe(INT_MIN);
  });

  it("INT_MIN - 1 wraps", () => {
    expect(resultNum(runMain([CREATE_ABC(OP_SUB, 0, 250, 251)], [kn(INT_MIN), kn(1)]))).toBe(INT_MAX);
  });

  it("INT_MAX * 2 wraps", () => {
    expect(resultNum(runMain([CREATE_ABC(OP_MUL, 0, 250, 251)], [kn(INT_MAX), kn(2)]))).toBe(-2);
  });

  it("INT_MIN / -1 is implementation-defined wrap", () => {
    expect(resultNum(runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(INT_MIN), kn(-1)]))).toBe(INT_MIN);
  });

  it("negative division toward zero", () => {
    expect(resultNum(runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(-7), kn(2)]))).toBe(-3);
    expect(resultNum(runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(7), kn(-2)]))).toBe(-3);
  });

  it("UNM of INT_MIN stays INT_MIN", () => {
    expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 1, 0), CREATE_ABC(OP_UNM, 0, 1, 0)], [kn(INT_MIN)]))).toBe(INT_MIN);
  });

  it("signed compare INT_MIN < -1", () => {
    const vm = runMain(
      [
        CREATE_ABC(OP_LT, 1, 250, 251),
        CREATE_AsBx(OP_JMP, 0, 1),
        CREATE_ABx(OP_LOADK, 0, 3),
        CREATE_ABx(OP_LOADK, 0, 2),
        CREATE_ABC(OP_RETURN, 0, 2, 0),
      ],
      [kn(INT_MIN), kn(-1), kn(1), kn(0)],
    );
    expect(resultNum(vm)).toBe(1);
  });

  it("LE INT_MAX", () => {
    const vm = runMain(
      [
        CREATE_ABC(OP_LE, 1, 250, 251),
        CREATE_AsBx(OP_JMP, 0, 1),
        CREATE_ABx(OP_LOADK, 0, 3),
        CREATE_ABx(OP_LOADK, 0, 2),
        CREATE_ABC(OP_RETURN, 0, 2, 0),
      ],
      [kn(INT_MAX), kn(INT_MAX), kn(1), kn(0)],
    );
    expect(resultNum(vm)).toBe(1);
  });

  it("EQ distinguishes wrap from identity", () => {
    const vm = runMain(
      [
        CREATE_ABC(OP_ADD, 0, 250, 251),
        CREATE_ABC(OP_EQ, 1, 0, 252),
        CREATE_AsBx(OP_JMP, 0, 1),
        CREATE_ABx(OP_LOADK, 1, 4),
        CREATE_ABx(OP_LOADK, 1, 3),
        CREATE_ABC(OP_RETURN, 1, 2, 0),
      ],
      [kn(INT_MAX), kn(1), kn(INT_MIN), kn(1), kn(0)],
    );
    expect(resultNum(vm)).toBe(1);
  });

  it("bitwise stays i32", () => {
    expect(resultNum(runMain([CREATE_ABC(OP_BAND, 0, 250, 251)], [kn(-1), kn(INT_MIN)]))).toBe(INT_MIN);
    expect(resultNum(runMain([CREATE_ABx(OP_LOADK, 1, 0), CREATE_ABC(OP_BNOT, 0, 1, 0)], [kn(0)]))).toBe(-1);
  });

  it("div0 is LuaRuntimeError (implementation-defined vs C UB)", () => {
    expect(() => runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(1), kn(0)])).toThrow(LuaRuntimeError);
  });
});
