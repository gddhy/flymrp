import { describe, expect, it } from "vitest";
import { ExtFault } from "../../src/abi/fault.ts";
import {
  EventError,
  LuaChunkFormatError,
  LuaRuntimeError,
  MrpFormatError,
  NativeAbiError,
  TimerError,
  VfsError,
} from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  LuaChunkReader,
  OP_CALL,
  OP_DIV,
  OP_GETGLOBAL,
  OP_LOADK,
  OP_MOVE,
  OP_POW,
  OP_RETURN,
  proto,
} from "../../src/lua/index.ts";
import { MRPArchive, buildMrp } from "../../src/mrp/index.ts";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { kn, ks, runMain } from "../helpers/lua.ts";
import { withRawHeader } from "../helpers/ext-asm.ts";

describe("5-A-12 error model", () => {
  it("MRP format error", () => {
    expect(() => MRPArchive.parse(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]))).toThrow(
      MrpFormatError,
    );
  });

  it("Lua chunk format error: signature", () => {
    expect(() => LuaChunkReader.load(new Uint8Array([0x1b, 0x4c, 0x75, 0x61]))).toThrow(LuaChunkFormatError);
  });

  it("Lua chunk format error: truncated", () => {
    expect(() => LuaChunkReader.load(new Uint8Array([0x1b, 0x4d, 0x52, 0x50, 0x80]))).toThrow(LuaChunkFormatError);
  });

  it("Lua runtime error: non-function call", () => {
    expect(() => runMain([CREATE_ABx(OP_LOADK, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2)], [kn(1)])).toThrow(LuaRuntimeError);
  });

  it("Lua runtime error: division by zero", () => {
    expect(() => runMain([CREATE_ABC(OP_DIV, 0, 250, 251)], [kn(1), kn(0)])).toThrow(LuaRuntimeError);
  });

  it("native ABI error: _strCom requires string", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 3,
          k: [ks("_strCom"), kn(601)],
          code: [
            CREATE_ABx(OP_GETGLOBAL, 0, 0),
            CREATE_ABx(OP_LOADK, 1, 1),
            CREATE_ABC(OP_CALL, 0, 2, 2),
            CREATE_ABC(OP_RETURN, 0, 2, 0),
          ],
        }),
      ),
    ).toThrow(NativeAbiError);
  });

  it("native ABI error: 801 without EXT", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_strCom"), kn(801), ks("")],
          code: [
            CREATE_ABx(OP_GETGLOBAL, 0, 0),
            CREATE_ABx(OP_LOADK, 1, 1),
            CREATE_ABx(OP_LOADK, 2, 2),
            CREATE_ABC(OP_CALL, 0, 3, 3),
          ],
        }),
      ),
    ).toThrow(NativeAbiError);
  });

  it("does not swallow POW-without-__pow", () => {
    expect(() => runMain([CREATE_ABC(OP_POW, 0, 250, 251)], [kn(2), kn(2)])).toThrow(LuaRuntimeError);
  });

  it("EXT / CPU architectural fault is not swallowed", () => {
    const undef = withRawHeader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "bad.ext", data: undef }]));
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 5,
          k: [ks("_strCom"), kn(601), ks("bad.ext"), kn(800), kn(0)],
          code: [
            CREATE_ABx(OP_GETGLOBAL, 0, 0),
            CREATE_ABx(OP_LOADK, 1, 1),
            CREATE_ABx(OP_LOADK, 2, 2),
            CREATE_ABC(OP_CALL, 0, 3, 2),
            CREATE_ABx(OP_GETGLOBAL, 1, 0),
            CREATE_ABx(OP_LOADK, 2, 3),
            CREATE_ABC(OP_MOVE, 3, 0, 0),
            CREATE_ABx(OP_LOADK, 4, 4),
            CREATE_ABC(OP_CALL, 1, 4, 2),
          ],
        }),
      ),
    ).toThrow(ExtFault);
  });
});

describe("5-B error model", () => {
  it("VfsError on closed FD", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.vfs.close(0)).not.toThrow();
    expect(() => rt.vfs.read(1, 1)).toThrow(VfsError);
  });

  it("TimerError on bad interval", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.timers.start(0, -1, "x", 1)).toThrow(TimerError);
  });

  it("EventError on overflow", () => {
    const rt = new MythroadRuntime();
    for (let i = 0; i < 64; i++) rt.queueEvent(3, i, 0, 0);
    expect(() => rt.queueEvent(3, 0, 0, 0)).toThrow(EventError);
  });

  it("Exit throws LuaRuntimeError Exiting...", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 2,
          k: [ks("Exit")],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 1)],
        }),
      ),
    ).toThrow(LuaRuntimeError);
    expect(rt.exited).toBe(true);
  });

  it("unimplemented _com is NativeAbiError not 0", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_com"), kn(9999)],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 2)],
        }),
      ),
    ).toThrow(NativeAbiError);
  });

  it("start without MRP is LuaRuntimeError", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.start()).toThrow(LuaRuntimeError);
  });

  it("unimplemented _strCom is NativeAbiError", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_strCom"), kn(500), ks("x")],
          code: [
            CREATE_ABx(OP_GETGLOBAL, 0, 0),
            CREATE_ABx(OP_LOADK, 1, 1),
            CREATE_ABx(OP_LOADK, 2, 2),
            CREATE_ABC(OP_CALL, 0, 3, 2),
          ],
        }),
      ),
    ).toThrow(NativeAbiError);
  });

  it("unknown input key is EventError", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.input.press("ZZ")).toThrow(EventError);
  });

  it("_mod 0 is LuaRuntimeError", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_mod"), kn(1), kn(0)],
          code: [
            CREATE_ABx(OP_GETGLOBAL, 0, 0),
            CREATE_ABx(OP_LOADK, 1, 1),
            CREATE_ABx(OP_LOADK, 2, 2),
            CREATE_ABC(OP_CALL, 0, 3, 2),
          ],
        }),
      ),
    ).toThrow(LuaRuntimeError);
  });
});

