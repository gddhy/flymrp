import { describe, expect, it } from "vitest";
import { NativeAbiError } from "../../src/err/errors.ts";
import { CREATE_ABC, CREATE_ABx, OP_CALL, OP_GETGLOBAL, OP_LOADK, OP_RETURN, proto } from "../../src/lua/index.ts";
import { gzipStore } from "../../src/mrp/gzip.ts";
import { buildMrp } from "../../src/mrp/index.ts";
import { md5, mrDecode, mrEncode, MythroadRuntime } from "../../src/mythroad/index.ts";
import { kn, ks } from "../helpers/lua.ts";

function bin(s: string): Uint8Array {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}

function strOf(u: Uint8Array): string {
  return String.fromCharCode(...u);
}

describe("5-C _strCom / _com", () => {
  it("300 unzip gzip", () => {
    const rt = new MythroadRuntime();
    const gz = gzipStore(bin("hello"));
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(300), ks(strOf(gz))],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("hello");
  });

  it("300 non-gzip returns original", () => {
    const rt = new MythroadRuntime();
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(300), ks("plain")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("plain");
  });

  it("500 MD5 length 16", () => {
    const rt = new MythroadRuntime();
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(500), ks("")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!.length).toBe(16);
    expect(strOf(md5(bin("")))).toBe(rt.lua.L.strings[rt.lua.L.nums[0]!]!);
  });

  it("501/502 encode decode roundtrip", () => {
    const raw = bin("Mythroad");
    const enc = mrEncode(raw)!;
    const dec = mrDecode(enc)!;
    expect(strOf(dec)).toBe("Mythroad");
    const rt = new MythroadRuntime();
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(501), ks("Mythroad")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe(strOf(enc));
  });

  it("502 decodes 501 output", () => {
    const rt = new MythroadRuntime();
    const enc = strOf(mrEncode(bin("ab"))!);
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(502), ks(enc)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("ab");
  });

  it("601 still reads resource", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: bin("Z") }]));
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(601), ks("a.txt")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.strings[rt.lua.L.nums[0]!]!).toBe("Z");
  });

  it("602 exists", () => {
    const rt = new MythroadRuntime();
    rt.loadMrp(buildMrp([{ name: "a.txt", data: bin("Z") }]));
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_strCom"), kn(602), ks("a.txt")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABC(OP_CALL, 0, 3, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.nums[0]).toBe(0);
  });

  it("_com 1 returns clock", () => {
    const rt = new MythroadRuntime();
    rt.clock = 123;
    rt.lua.runCold(
      proto({
        maxstack: 4,
        k: [ks("_com"), kn(1)],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABC(OP_CALL, 0, 2, 2),
          CREATE_ABC(OP_RETURN, 0, 2, 0),
        ],
      }),
    );
    expect(rt.lua.L.nums[0]).toBe(123);
  });

  it("unimplemented stays NativeAbiError", () => {
    const rt = new MythroadRuntime();
    expect(() =>
      rt.lua.runCold(
        proto({
          maxstack: 4,
          k: [ks("_strCom"), kn(700), ks("x")],
          code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABx(OP_LOADK, 2, 2), CREATE_ABC(OP_CALL, 0, 3, 2)],
        }),
      ),
    ).toThrow(NativeAbiError);
  });
});
