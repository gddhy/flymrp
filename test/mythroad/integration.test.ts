import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR } from "../../src/abi/layout.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  OP_CALL,
  OP_GETGLOBAL,
  OP_LOADK,
  OP_MOVE,
  OP_RETURN,
  dumpChunk,
  proto,
} from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { kn, ks } from "../helpers/lua.ts";
import { assembleArmHelperAt, buildArmLoadImage, buildArmTableCaller } from "../helpers/ext-asm.ts";
import { ARM_LOAD_HELPER_OFF } from "../helpers/ext-asm.ts";

function startMr(extra?: { after801?: number[] }): Uint8Array {
  return dumpChunk(
    proto({
      maxstack: 8,
      k: [ks("_strCom"), kn(601), ks("test.ext"), kn(800), kn(0), kn(801), ks("")],
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
        CREATE_ABx(OP_GETGLOBAL, 2, 0),
        CREATE_ABx(OP_LOADK, 3, 5),
        CREATE_ABx(OP_LOADK, 4, 6),
        CREATE_ABx(OP_LOADK, 5, 4),
        CREATE_ABC(OP_CALL, 2, 4, 3),
        ...(extra?.after801 ?? []),
        CREATE_ABC(OP_RETURN, 3, 2, 0),
      ],
    }),
  );
}

describe("5-A-11 Lua ↔ EXT", () => {
  it("Lua → native _strCom(601) reads MRP file", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "note.txt", data: Uint8Array.from("XYZ", (c) => c.charCodeAt(0)) }]));
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(601), ks("note.txt")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("XYZ");
  });

  it("Lua → _strCom(800) loads EXT", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const ext = buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0x11 }),
    });
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "start.mr", data: startMr() }, { name: "test.ext", data: ext }]));
    rt.start();
    expect(rt.ext).not.toBeNull();
  });

  it("Lua → EXT → Lua return", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const ext = buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0x42 }),
    });
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "start.mr", data: startMr() }, { name: "test.ext", data: ext }]));
    rt.start();
    expect(rt.lua.L.nums[0]!).toBe(0x42);
  });

  it("Lua → EXT → table[N] → host → EXT → Lua", () => {
    const dest = EXT_CODE_ADDR;
    const helperAt = dest + ARM_LOAD_HELPER_OFF;
    const ext = buildArmLoadImage({
      dest,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0 }),
    });
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "start.mr", data: startMr() }, { name: "test.ext", data: ext }]));
    rt.start();
    rt.ext!.registerHandler(5, (_c, _m, a) => (a[0] + a[1]) >>> 0);
    rt.ext!.pokeCode(helperAt, buildArmTableCaller({ dest: helperAt, slot: 5, r0: 3, r1: 4 }));
    expect(rt.ext!.arm_ext_call(0).r0).toBe(7);
    rt.lua.runCold(
      proto({
        maxstack: 8,
        k: [ks("_strCom"), kn(801), ks(""), kn(0)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABC(OP_CALL, 0, 4, 3),
          CREATE_ABC(OP_RETURN, 1, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.nums[0]!).toBe(7);
  });

  it("full MRP start.mr chain is deterministic", () => {
    const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
    const ext = buildArmLoadImage({
      dest: EXT_CODE_ADDR,
      helperWords: assembleArmHelperAt(helperAt, { ret0: 0x5a }),
    });
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "start.mr", data: startMr() }, { name: "test.ext", data: ext }]));
    rt.start();
    expect(rt.lua.L.nums[0]!).toBe(0x5a);
    const rt2 = new MythroadRuntime();
    rt2.loadMrp(buildMrp([{ name: "start.mr", data: startMr() }, { name: "test.ext", data: ext }]));
    rt2.start();
    expect(rt2.lua.L.nums[0]!).toBe(0x5a);
  });
});
