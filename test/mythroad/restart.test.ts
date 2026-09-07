import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  OP_CALL,
  OP_GETGLOBAL,
  OP_LOADK,
  OP_RETURN,
  dumpChunk,
  proto,
} from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import {
  MR_STATE_RESTART,
  MR_STATE_RUN,
  MR_SUCCESS,
  MR_TIMER_STATE_IDLE,
  MythroadRuntime,
} from "../../src/mythroad/index.ts";
import { kn, ks, invoke } from "../helpers/lua.ts";

function chunkSetFlag(n: number): Uint8Array {
  return dumpChunk(
    proto({
      maxstack: 4,
      k: [ks("_com"), kn(403), kn(n)],
      code: [
        CREATE_ABx(OP_GETGLOBAL, 0, 0),
        CREATE_ABx(OP_LOADK, 1, 1),
        CREATE_ABx(OP_LOADK, 2, 2),
        CREATE_ABC(OP_CALL, 0, 3, 1),
        CREATE_ABC(OP_RETURN, 0, 1, 0),
      ],
    }),
  );
}

describe("5-C restart / runFile", () => {
  it('switches archive resources, keeps extracted files and returns to the parent entry', () => {
    const rt = new MythroadRuntime();
    const child = buildMrp([{name:'start.mr', data:chunkSetFlag(2)}, {name:'scene.dat', data:new Uint8Array([2])}]);
    rt.loadMrp(buildMrp([{name:'start.mr',data:chunkSetFlag(1)}, {name:'return.mr',data:chunkSetFlag(3)}, {name:'child.mrp',data:child}, {name:'scene.dat',data:new Uint8Array([1])}]));
    rt.start(); const parent = rt.packName;
    rt.appFs.replace('save.dat', new Uint8Array([42]));
    invoke(rt.lua, '_strCom', [3, parent, 'return.mr']);
    rt.requestRunFile('child.mrp', 'start.mr', 'child'); rt.advance(100); rt.step();
    expect(rt.gcThreshold).toBe(2); expect(rt.vfs.readFile('scene.dat')?.[0]).toBe(2);
    expect(rt.vfs.readFile('save.dat')?.[0]).toBe(42);
    expect(() => rt.exitGuest()).toThrow();
    rt.advance(100); rt.step();
    expect(rt.gcThreshold).toBe(3); expect(rt.packName).toBe(parent);
    expect(rt.vfs.readFile('scene.dat')?.[0]).toBe(1);
  });
  it("RunFile sets RESTART and arms 100ms restart timer", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    rt.lua.runCold(
      proto({
        maxstack: 6,
        k: [ks("RunFile"), ks("pack"), ks("next.mr"), ks("p")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABC(OP_CALL, 0, 4, 1),
        ],
      }),
    );
    expect(rt.state).toBe(MR_STATE_RESTART);
    expect(rt.timers.callback).toBe("restart");
    expect(rt.timers.interval).toBe(100);
    expect(rt.lastAction?.kind).toBe("RUN_FILE");
  });

  it("timer applies restart without recursive runFile", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(
      buildMrp([
        { name: "start.mr", data: chunkSetFlag(1) },
        { name: "next.mr", data: chunkSetFlag(99) },
      ]),
    );
    rt.start();
    rt.requestRunFile(rt.packName, "next.mr", "q");
    expect(rt.state).toBe(MR_STATE_RESTART);
    rt.advance(100);
    expect(rt.step()).toBe(true);
    expect(rt.state).toBe(MR_STATE_RUN);
    expect(rt.gcThreshold).toBe(99);
    expect(rt.param).toBe("q");
    expect(rt.lastAction?.kind).toBe("RESTART");
  });

  it("pause during RESTART stops timer", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    rt.requestRunFile("p", "x.mr", "");
    expect(rt.pause()).toBe(MR_SUCCESS);
    expect(rt.timers.state).toBe(MR_TIMER_STATE_IDLE);
    expect(rt.state).toBe(MR_STATE_RESTART);
  });

  it("resume during RESTART rearms restart", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    rt.requestRunFile("p", "x.mr", "");
    rt.pause();
    expect(rt.resume()).toBe(MR_SUCCESS);
    expect(rt.timers.callback).toBe("restart");
    expect(rt.state).toBe(MR_STATE_RESTART);
  });

  it("missing restart file is LuaRuntimeError", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "start.mr", data: chunkSetFlag(1) }]));
    rt.start();
    rt.requestRunFile("p", "missing.mr", "");
    rt.advance(100);
    expect(() => rt.step()).toThrow(LuaRuntimeError);
  });
});
