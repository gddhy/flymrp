import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import { TAG_BOOL, TAG_NIL, TAG_NUMBER, TAG_STRING, TAG_TABLE, call } from "../../src/lua/index.ts";
import { MR_SUCCESS, MythroadRuntime } from "../../src/mythroad/index.ts";

function saveLoad(rt: MythroadRuntime, build: (L: typeof rt.lua.L) => { tag: number; num: number }): { tag: number; num: number } {
  const L = rt.lua.L;
  const perms = L.newTable();
  const root = build(L);
  L.top = 0;
  L.base = 1;
  L.ci.length = 1;
  L.ci[0]!.base = 1;
  L.setFn(0, L.getGlobal("SaveTable").num);
  L.setTbl(1, perms);
  L.tags[2] = root.tag;
  L.nums[2] = root.num;
  L.top = 3;
  L.pushString("save.bin");
  call(L, 0, 1);
  expect(L.nums[0]!).toBe(MR_SUCCESS);
  L.top = 0;
  L.base = 1;
  L.setFn(0, L.getGlobal("LoadTable").num);
  L.setTbl(1, perms);
  L.top = 2;
  L.pushString("save.bin");
  call(L, 0, 1);
  return { tag: L.tags[0]!, num: L.nums[0]! };
}

describe("5-C SaveTable / LoadTable", () => {
  it('_store preserves scores and cyclic tables through the Lua wrapper entry points', () => {
    const rt = new MythroadRuntime(), L = rt.lua.L, perms = L.newTable(), root = L.newTable();
    L.tables[root]!.setNum(1, { tag: TAG_NUMBER, num: 12345 });
    L.tables[root]!.setNum(2, { tag: TAG_TABLE, num: root });
    const store = L.tables[L.getGlobal('_store').num]!;
    L.top = 0; L.base = 1; L.ci.length = 1; L.ci[0]!.base = 1;
    L.setFn(0, store.getStr(L.internStr('store')).num);
    L.setTbl(1, perms); L.setTbl(2, root); L.top = 3;
    call(L, 0, 1);
    expect(L.tags[0]).toBe(TAG_STRING);
    const bytes = L.strings[L.nums[0]];
    L.setFn(0, store.getStr(L.internStr('load')).num);
    L.setTbl(1, perms); L.top = 2; L.pushString(bytes);
    call(L, 0, 1);
    expect(L.tags[0]).toBe(TAG_TABLE);
    const restored = L.nums[0];
    expect(L.tables[restored]!.getNum(1)).toEqual({ tag: TAG_NUMBER, num: 12345 });
    expect(L.tables[restored]!.getNum(2)).toEqual({ tag: TAG_TABLE, num: restored });
  });
  it("roundtrip number", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, () => ({ tag: TAG_NUMBER, num: 42 }));
    expect(o.tag).toBe(TAG_NUMBER);
    expect(o.num).toBe(42);
  });

  it("roundtrip string with zero", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, (L) => ({ tag: TAG_STRING, num: L.internStr("a\0b") }));
    expect(rt.lua.L.strings[o.num]).toBe("a\0b");
  });

  it("roundtrip bool in table", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, (L) => {
      const t = L.newTable();
      L.tables[t]!.set(TAG_STRING, L.internStr("ok"), { tag: TAG_BOOL, num: 1 });
      return { tag: TAG_TABLE, num: t };
    });
    const v = rt.lua.L.tables[o.num]!.get(TAG_STRING, rt.lua.L.internStr("ok"));
    expect(v.tag).toBe(TAG_BOOL);
    expect(v.num).toBe(1);
  });

  it("integer keys", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, (L) => {
      const t = L.newTable();
      L.tables[t]!.setNum(1, { tag: TAG_NUMBER, num: 9 });
      return { tag: TAG_TABLE, num: t };
    });
    expect(rt.lua.L.tables[o.num]!.getNum(1).num).toBe(9);
  });

  it("nested tables", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, (L) => {
      const inner = L.newTable();
      L.tables[inner]!.set(TAG_STRING, L.internStr("n"), { tag: TAG_NUMBER, num: 3 });
      const outer = L.newTable();
      L.tables[outer]!.set(TAG_STRING, L.internStr("c"), { tag: TAG_TABLE, num: inner });
      return { tag: TAG_TABLE, num: outer };
    });
    const c = rt.lua.L.tables[o.num]!.get(TAG_STRING, rt.lua.L.internStr("c"));
    expect(rt.lua.L.tables[c.num]!.get(TAG_STRING, rt.lua.L.internStr("n")).num).toBe(3);
  });

  it("cycle", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, (L) => {
      const t = L.newTable();
      L.tables[t]!.set(TAG_STRING, L.internStr("self"), { tag: TAG_TABLE, num: t });
      return { tag: TAG_TABLE, num: t };
    });
    const self = rt.lua.L.tables[o.num]!.get(TAG_STRING, rt.lua.L.internStr("self"));
    expect(self.num).toBe(o.num);
  });

  it("nil root", () => {
    const rt = new MythroadRuntime();
    const o = saveLoad(rt, () => ({ tag: TAG_NIL, num: 0 }));
    expect(o.tag).toBe(TAG_NIL);
  });

  it("missing file leaves perms", () => {
    const rt = new MythroadRuntime();
    const L = rt.lua.L;
    const perms = L.newTable();
    L.top = 0;
    L.base = 1;
    L.ci.length = 1;
    L.setFn(0, L.getGlobal("LoadTable").num);
    L.setTbl(1, perms);
    L.top = 2;
    L.pushString("no-such.bin");
    call(L, 0, 1);
    expect(L.tags[0]).toBe(TAG_TABLE);
    expect(L.nums[0]).toBe(perms);
  });

  it("rejects function", () => {
    const rt = new MythroadRuntime();
    const L = rt.lua.L;
    const perms = L.newTable();
    const fn = L.newCClosure(() => 0);
    L.top = 0;
    L.base = 1;
    L.ci.length = 1;
    L.setFn(0, L.getGlobal("SaveTable").num);
    L.setTbl(1, perms);
    L.setFn(2, fn);
    L.top = 3;
    L.pushString("f.bin");
    expect(() => call(L, 0, 1)).toThrow(LuaRuntimeError);
  });
});
