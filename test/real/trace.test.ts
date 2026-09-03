import { describe, expect, it } from "vitest";
import { NativeAbiError, UnknownAbiError } from "../../src/err/errors.ts";
import { CREATE_ABC, CREATE_ABx, OP_CALL, OP_GETGLOBAL, OP_LOADK, proto } from "../../src/lua/index.ts";
import { MythroadRuntime, RuntimeTrace } from "../../src/mythroad/index.ts";
import { kn, ks } from "../helpers/lua.ts";

describe("5-C.1 runtime trace / unknown ABI", () => {
  it("trace is off by default and does not change GetSysInfo", () => {
    const rt = new MythroadRuntime();
    expect(rt.trace).toBeNull();
    rt.lua.runCold(
      proto({
        maxstack: 3,
        k: [ks("GetSysInfo")],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2)],
      }),
    );
    expect(rt.lua.L.tags[0]).toBe(5);
  });

  it("enabled trace records native and vfs without changing result", () => {
    const tr = new RuntimeTrace();
    const rt = new MythroadRuntime({ trace: tr });
    rt.lua.runCold(
      proto({
        maxstack: 3,
        k: [ks("GetSysInfo")],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2)],
      }),
    );
    expect(tr.records.some((r) => r.operation === "native")).toBe(true);
    expect(rt.lua.L.tags[0]).toBe(5);
  });

  it("unknown _com is NativeAbiError / UnknownAbiError in strict", () => {
    const tr = new RuntimeTrace();
    const rt = new MythroadRuntime({ trace: tr, abiMode: "strict" });
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_com"), kn(700)],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2)],
        }),
      ),
    ).toThrow(NativeAbiError);
    expect(rt.unknownEvents.length).toBe(1);
    expect(rt.unknownEvents[0]!.family).toBe("_com");
    expect(rt.unknownEvents[0]!.code).toBe(700);
    expect(tr.unknown.length).toBe(1);
  });

  it("unknown _strCom records then stops", () => {
    const rt = new MythroadRuntime({ trace: true });
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_strCom"), kn(700), ks("x")],
          code: [
            CREATE_ABx(OP_GETGLOBAL, 0, 0),
            CREATE_ABx(OP_LOADK, 1, 1),
            CREATE_ABx(OP_LOADK, 2, 2),
            CREATE_ABC(OP_CALL, 0, 3, 2),
          ],
        }),
      ),
    ).toThrow(UnknownAbiError);
    expect(rt.unknownEvents[0]!.family).toBe("_strCom");
  });

  it("permissive without approval still stops", () => {
    const rt = new MythroadRuntime({ abiMode: "permissive" });
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_com"), kn(700)],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2)],
        }),
      ),
    ).toThrow(UnknownAbiError);
  });

  it("permissive + explicit approval may return 0", () => {
    const rt = new MythroadRuntime({ abiMode: "permissive", approvedUnknown: { "_com:700": "return0" } });
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_com"), kn(700)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2)],
      }),
    );
    expect(rt.lua.L.nums[0]).toBe(0);
    expect(rt.unknownEvents.length).toBe(1);
  });

  it("event dispatch is traced", () => {
    const tr = new RuntimeTrace();
    const rt = new MythroadRuntime({ trace: tr });
    rt.state = 1;
    rt.lua.register("dealevent", () => 0);
    rt.queueEvent(4, 0, 0, 0);
    rt.step();
    expect(tr.records.some((r) => r.operation === "event")).toBe(true);
    expect(tr.records.some((r) => r.operation === "lua_global")).toBe(true);
  });
});
