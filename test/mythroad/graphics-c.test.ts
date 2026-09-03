import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import { CREATE_ABC, CREATE_ABx, OP_CALL, OP_GETGLOBAL, OP_LOADK, proto } from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import { MythroadRuntime, NullGraphicsBackend } from "../../src/mythroad/index.ts";
import { kn, ks } from "../helpers/lua.ts";

function gfx(): { rt: MythroadRuntime; g: NullGraphicsBackend } {
  const g = new NullGraphicsBackend();
  const rt = new MythroadRuntime({ graphics: g });
  rt.state = 1;
  rt.bi = 1;
  return { rt, g };
}

function callName(rt: MythroadRuntime, name: string, args: number[]): void {
  const k = [ks(name), ...args.map((n) => kn(n))];
  const code = [CREATE_ABx(OP_GETGLOBAL, 0, 0)];
  for (let i = 0; i < args.length; i++) code.push(CREATE_ABx(OP_LOADK, i + 1, i + 1));
  code.push(CREATE_ABC(OP_CALL, 0, args.length + 1, 1));
  rt.lua.runCold(proto({ maxstack: args.length + 3, k, code }));
}

describe("5-C graphics command recording", () => {
  it("BitmapNew + BitmapShow", () => {
    const { rt, g } = gfx();
    callName(rt, "BitmapNew", [1, 8, 8]);
    callName(rt, "BitmapShow", [1, 2, 3]);
    expect(g.commands.some((c) => c.op === "image" && c.sub === "new")).toBe(true);
    expect(g.commands.some((c) => c.op === "image" && c.sub === "show" && c.i === 1)).toBe(true);
  });

  it("BitmapLoad needs BI and file", () => {
    const { rt, g } = gfx();
    rt.loadMrp(buildMrp([{ name: "a.bmp", data: new Uint8Array(16) }]));
    rt.lua.runCold(
      proto({
        maxstack: 10,
        k: [ks("BitmapLoad"), kn(0), ks("a.bmp"), kn(0), kn(0), kn(2), kn(2), kn(2)],
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
    expect(g.commands.some((c) => c.op === "image" && c.sub === "load")).toBe(true);
  });

  it("BitmapLoad without BI errors", () => {
    const { rt } = gfx();
    rt.bi = 0;
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 8,
          k: [ks("BitmapLoad"), kn(0), ks("x"), kn(0), kn(0), kn(1), kn(1), kn(1)],
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
      ),
    ).toThrow(LuaRuntimeError);
  });

  it("BitmapDraw records image", () => {
    const { rt, g } = gfx();
    callName(rt, "BitmapNew", [0, 4, 4]);
    callName(rt, "BitmapNew", [1, 4, 4]);
    callName(rt, "BitmapDraw", [0, 1, 2, 1, 0, 0, 2, 2, 1, 0, 0, 1, 0]);
    expect(g.commands.some((c) => c.op === "image" && c.sub === "draw")).toBe(true);
  });

  it("SpriteSet + SpriteDraw", () => {
    const { rt, g } = gfx();
    callName(rt, "SpriteSet", [0, 16]);
    callName(rt, "SpriteDraw", [0, 1, 3, 4]);
    expect(g.commands.some((c) => c.op === "sprite" && c.spriteindex === 1)).toBe(true);
  });

  it("TileSet + TileSetRect + TileDraw", () => {
    const { rt, g } = gfx();
    callName(rt, "TileSet", [0, 1, 2, 3, 4, 8]);
    callName(rt, "TileSetRect", [0, 0, 0, 10, 10]);
    callName(rt, "TileDraw", [0]);
    expect(g.commands.some((c) => c.op === "tile" && c.sub === "set")).toBe(true);
    expect(g.commands.some((c) => c.op === "tile" && c.sub === "rect")).toBe(true);
    expect(g.commands.some((c) => c.op === "tile" && c.sub === "draw")).toBe(true);
  });

  it("snapshot: clear/point/line/rect/text/flush still record", () => {
    const { rt, g } = gfx();
    callName(rt, "_clearScr", [1, 2, 3]);
    callName(rt, "_drawPoint", [4, 5, 6, 7, 8]);
    callName(rt, "_drawLine", [0, 0, 1, 1, 9, 8, 7]);
    callName(rt, "_drawRect", [1, 2, 3, 4, 5, 6, 7]);
    expect(g.commands.map((c) => c.op)).toEqual(["clear", "point", "line", "rect"]);
  });

  it("text and flush record", () => {
    const { rt, g } = gfx();
    rt.lua.runCold(
      proto({
        maxstack: 10,
        k: [ks("_drawText"), ks("hi"), kn(1), kn(2), kn(3), kn(4), kn(5), kn(0), kn(0)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABx(OP_LOADK, 4, 4),
          CREATE_ABx(OP_LOADK, 5, 5),
          CREATE_ABx(OP_LOADK, 6, 6),
          CREATE_ABx(OP_LOADK, 7, 7),
          CREATE_ABx(OP_LOADK, 8, 8),
          CREATE_ABC(OP_CALL, 0, 9, 1),
        ],
      }),
    );
    callName(rt, "_dispUp", [0, 0, 10, 10]);
    expect(g.commands.some((c) => c.op === "text" && c.text === "hi")).toBe(true);
    expect(g.commands.some((c) => c.op === "flush")).toBe(true);
  });
});
