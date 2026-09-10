import { describe, expect, it } from "vitest";
import {
  CREATE_ABC,
  CREATE_ABx,
  OP_CALL,
  OP_GETGLOBAL,
  OP_LOADK,
} from "../../src/lua/index.ts";
import { MythroadRuntime, NullGraphicsBackend } from "../../src/mythroad/index.ts";
import { kn, ks, proto } from "../helpers/lua.ts";

function gfx(): { rt: MythroadRuntime; g: NullGraphicsBackend } {
  const g = new NullGraphicsBackend();
  const rt = new MythroadRuntime({ graphics: g });
  rt.state = 1;
  return { rt, g };
}

describe("5-B NullGraphicsBackend", () => {
  it("records _clearScr", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 6,
        k: [ks("_clearScr"), kn(1), kn(2), kn(3)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABC(OP_CALL, 0, 4, 1),
        ],
      }),
    );
    expect(g.commands[0]).toEqual({ op: "clear", r: 1, g: 2, b: 3 });
  });

  it("records _drawRect coordinates", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 10,
        k: [ks("_drawRect"), kn(4), kn(5), kn(6), kn(7), kn(8), kn(9), kn(10)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABx(OP_LOADK, 5, 5),
          CREATE_ABx(OP_LOADK, 6, 6),
          CREATE_ABx(OP_LOADK, 7, 7),
          CREATE_ABC(OP_CALL, 0, 8, 1),
        ],
      }),
    );
    expect(g.commands[0]).toMatchObject({ op: "rect", x: 4, y: 5, w: 6, h: 7, r: 8, g: 9, b: 10 });
  });

  it("records _drawText text", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 10,
        k: [ks("_drawText"), ks("hello"), kn(0), kn(1), kn(255), kn(0), kn(0)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABx(OP_LOADK, 5, 5),
          CREATE_ABx(OP_LOADK, 6, 6),
          CREATE_ABC(OP_CALL, 0, 7, 1),
        ],
      }),
    );
    expect(g.commands[0]).toMatchObject({ op: "text", text: "hello", x: 0, y: 1 });
  });

  it("records _dispUp flush", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 8,
        k: [ks("_dispUp"), kn(0), kn(0), kn(240), kn(320)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABC(OP_CALL, 0, 5, 1),
        ],
      }),
    );
    expect(g.commands[0]).toMatchObject({ op: "flush", x: 0, y: 0, w: 240, h: 320 });
  });

  it("records EffSetCon", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 10,
        k: [ks("EffSetCon"), kn(1), kn(2), kn(3), kn(4), kn(5), kn(6), kn(7)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABx(OP_LOADK, 5, 5),
          CREATE_ABx(OP_LOADK, 6, 6),
          CREATE_ABx(OP_LOADK, 7, 7),
          CREATE_ABC(OP_CALL, 0, 8, 1),
        ],
      }),
    );
    expect(g.commands[0]).toMatchObject({ op: "eff", perr: 5, perg: 6, perb: 7 });
  });

  it("records _drawLine", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 10,
        k: [ks("_drawLine"), kn(0), kn(0), kn(10), kn(10), kn(1), kn(2), kn(3)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABx(OP_LOADK, 5, 5),
          CREATE_ABx(OP_LOADK, 6, 6),
          CREATE_ABx(OP_LOADK, 7, 7),
          CREATE_ABC(OP_CALL, 0, 8, 1),
        ],
      }),
    );
    expect(g.commands[0]).toMatchObject({ op: "line", x2: 10, y2: 10 });
  });

  it("records _drawPoint", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 8,
        k: [ks("_drawPoint"), kn(3), kn(4), kn(9), kn(8), kn(7)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABx(OP_LOADK, 5, 5),
          CREATE_ABC(OP_CALL, 0, 6, 1),
        ],
      }),
    );
    expect(g.commands[0]).toMatchObject({ op: "point", x: 3, y: 4, r: 9 });
  });

  it("_dispUpEx no-op when not RUN", () => {
    const g = new NullGraphicsBackend();
    const rt = new MythroadRuntime({ graphics: g });
    rt.state = 0;
    rt.lua.runCold(
      proto({
        maxstack: 8,
        k: [ks("_dispUpEx"), kn(0), kn(0), kn(1), kn(1)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABC(OP_CALL, 0, 5, 1),
        ],
      }),
    );
    expect(g.commands.length).toBe(0);
  });
});
