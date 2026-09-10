import { describe, expect, it } from "vitest";
import { VfsError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  OP_CALL,
  OP_GETGLOBAL,
  OP_GETTABLE,
  OP_LOADK,
  OP_MOVE,
  OP_RETURN,
} from "../../src/lua/index.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import {
  MR_FAILED,
  MR_FILE_CREATE,
  MR_FILE_RDONLY,
  MR_FILE_RDWR,
  MR_IS_FILE,
  MR_SEEK_SET,
  MythroadRuntime,
} from "../../src/mythroad/index.ts";
import { kn, ks, proto } from "../helpers/lua.ts";

function run(rt: MythroadRuntime, code: number[], k: ReturnType<typeof kn>[]) {
  rt.lua.runCold(proto({ maxstack: 8, k, code }));
}

describe("5-B VFS / resource", () => {
  it("readFile from ROM MRP", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: Uint8Array.from("hi", (c) => c.charCodeAt(0)) }]));
    expect(new TextDecoder().decode(rt.vfs.readFile("a.txt")!)).toBe("hi");
  });

  it("exists / size / missing", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: new Uint8Array([1, 2, 3]) }]));
    expect(rt.vfs.exists("a.txt")).toBe(true);
    expect(rt.vfs.size("a.txt")).toBe(3);
    expect(rt.vfs.exists("nope")).toBe(false);
    expect(rt.vfs.size("nope")).toBe(MR_FAILED);
  });

  it("info is MR_IS_FILE", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: new Uint8Array([1]) }]));
    expect(rt.vfs.info("a.txt")).toBe(MR_IS_FILE);
    expect(rt.vfs.info("x")).toBe(MR_FAILED);
  });

  it("open/read/seek/close typed FD", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: Uint8Array.from("abcd", (c) => c.charCodeAt(0)) }]));
    const fd = rt.vfs.open("a.txt", MR_FILE_RDONLY);
    expect(fd).toBeGreaterThan(0);
    expect(new TextDecoder().decode(rt.vfs.read(fd, 2))).toBe("ab");
    expect(rt.vfs.seek(fd, 1, MR_SEEK_SET)).toBe(0);
    expect(new TextDecoder().decode(rt.vfs.read(fd, 2))).toBe("bc");
    expect(rt.vfs.close(fd)).toBe(0);
  });

  it("write CREATE RAM overlay", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([]));
    const fd = rt.vfs.open("w.txt", MR_FILE_CREATE | MR_FILE_RDWR);
    rt.vfs.write(fd, Uint8Array.from("xy", (c) => c.charCodeAt(0)));
    rt.vfs.close(fd);
    expect(new TextDecoder().decode(rt.vfs.readFile("w.txt")!)).toBe("xy");
  });

  it("write on RDONLY throws VfsError", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: new Uint8Array([1]) }]));
    const fd = rt.vfs.open("a.txt", MR_FILE_RDONLY);
    expect(() => rt.vfs.write(fd, new Uint8Array([2]))).toThrow(VfsError);
  });

  it("invalid FD throws", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.vfs.read(99, 1)).toThrow(VfsError);
  });

  it("Lua file.readAll", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "n.txt", data: Uint8Array.from("Z", (c) => c.charCodeAt(0)) }]));
    run(rt, [
      CREATE_ABx(OP_GETGLOBAL, 0, 0),
      CREATE_ABC(OP_GETTABLE, 0, 0, 251),
      CREATE_ABx(OP_LOADK, 1, 2),
      CREATE_ABC(OP_CALL, 0, 2, 2),
      CREATE_ABC(OP_RETURN, 0, 2, 0),
    ], [ks("file"), ks("readAll"), ks("n.txt")]);
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("Z");
  });

  it("Lua file.open + :read", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "n.txt", data: Uint8Array.from("PQ", (c) => c.charCodeAt(0)) }]));
    run(rt, [
      CREATE_ABx(OP_GETGLOBAL, 0, 0),
      CREATE_ABC(OP_GETTABLE, 0, 0, 251),
      CREATE_ABx(OP_LOADK, 1, 2),
      CREATE_ABC(OP_CALL, 0, 2, 2),
      CREATE_ABC(OP_GETTABLE, 1, 0, 253),
      CREATE_ABC(OP_MOVE, 2, 0, 0),
      CREATE_ABx(OP_LOADK, 3, 4),
      CREATE_ABC(OP_CALL, 1, 3, 2),
      CREATE_ABC(OP_RETURN, 1, 2, 0),
    ], [ks("file"), ks("open"), ks("n.txt"), ks("read"), kn(2)]);
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("PQ");
  });

  it("_strCom(602) exists", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "e.bin", data: new Uint8Array([9]) }]));
    run(rt, [
      CREATE_ABx(OP_GETGLOBAL, 0, 0),
      CREATE_ABx(OP_LOADK, 1, 1),
      CREATE_ABx(OP_LOADK, 2, 2),
      CREATE_ABC(OP_CALL, 0, 3, 2),
      CREATE_ABC(OP_RETURN, 0, 2, 0),
    ], [ks("_strCom"), kn(602), ks("e.bin")]);
    expect(rt.lua.L.nums[0]!).toBe(0);
  });

  it("_strCom(602) missing is nil", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([]));
    run(rt, [
      CREATE_ABx(OP_GETGLOBAL, 0, 0),
      CREATE_ABx(OP_LOADK, 1, 1),
      CREATE_ABx(OP_LOADK, 2, 2),
      CREATE_ABC(OP_CALL, 0, 3, 2),
    ], [ks("_strCom"), kn(602), ks("no")]);
    expect(rt.lua.L.tags[0]!).toBe(0);
  });

  it("open missing without CREATE returns 0", () => {
    const rt = new MythroadRuntime();
    expect(rt.vfs.open("no", MR_FILE_RDONLY)).toBe(0);
  });
});
