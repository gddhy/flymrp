import { describe, expect, it } from "vitest";
import { classifyKaiOSKey, detectKaiOS } from "../../web/kaios.ts";
import { installKaiOSPolyfills } from "../../web/kaios-polyfill.ts";
import { parenthesizeYields } from "../../tools/kaios-yield.ts";
import { DOM_KEY } from "../../web/controls.ts";
import { catalogHref, installedGamesFromSd, isMrpFilename, playerHref } from "../../web/library.ts";

describe("KaiOS keypad helpers", () => {
  it("detects the packaged build, query flag, UA, and B2G host", () => {
    expect(detectKaiOS({ flag: true })).toBe(true);
    expect(detectKaiOS({ search: "?game=1&kaios=1" })).toBe(true);
    expect(detectKaiOS({ search: "?kaios=true" })).toBe(true);
    expect(detectKaiOS({ ua: "Mozilla/5.0 (Mobile; LYF/F90M; Android 4.4.2) KAIOS/2.5" })).toBe(true);
    expect(detectKaiOS({ b2g: true })).toBe(true);
    expect(detectKaiOS({ ua: "Mozilla/5.0 Chrome/120", search: "" })).toBe(false);
  });
  it("maps feature-phone keys and keeps Backspace as back, not a game soft key", () => {
    const key = (value: string, keyCode?: number) => classifyKaiOSKey({ key: value, keyCode: keyCode ?? 0 } as unknown as KeyboardEvent);
    expect(key("ArrowUp")).toBe("up");
    expect(key("Enter")).toBe("enter");
    expect(key("SoftLeft")).toBe("softLeft");
    expect(key("SoftRight")).toBe("softRight");
    expect(key("Backspace")).toBe("back");
    expect(key("EndCall")).toBe("back");
    expect(key("Q", 403)).toBe("softLeft");
    expect(key("*")).toBeUndefined();
    expect(key("5")).toBeUndefined();
    expect(DOM_KEY.SoftLeft).toBe("SOFTLEFT");
    expect(DOM_KEY.SoftRight).toBe("SOFTRIGHT");
  });
  it("parenthesizes yield for Gecko 48 comma lists and call arguments", () => {
    expect(parenthesizeYields("try{yield ya(g.path),e(g.path,null),n(),yield i(),r.textContent=x}")).toBe(
      "try{(yield ya(g.path)),e(g.path,null),n(),(yield i()),r.textContent=x}",
    );
    expect(parenthesizeYields("new Uint8Array(yield A.arrayBuffer())")).toBe("new Uint8Array((yield A.arrayBuffer()))");
    expect(parenthesizeYields("let c=yield fetch(u);")).toBe("let c=(yield fetch(u));");
    expect(parenthesizeYields("s?yield wa(a):yield ya(a)")).toBe("s?(yield wa(a)):(yield ya(a))");
    expect(parenthesizeYields("r.add(o),yield{address:o}")).toBe("r.add(o),(yield{address:o})");
    expect(parenthesizeYields('const msg="yield foo";')).toBe('const msg="yield foo";');
    expect(parenthesizeYields("yield Promise.all(function*(){let a=yield fetch(u)})")).toBe(
      "(yield Promise.all(function*(){let a=(yield fetch(u))}))",
    );
  });
  it("installs missing ES2017+ helpers without changing existing implementations", () => {
    installKaiOSPolyfills();
    expect([1, 2, 3].at(-1)).toBe(3);
    expect(Object.entries({ a: 1, b: 2 })).toEqual([["a", 1], ["b", 2]]);
    expect(Object.values({ a: 1, b: 2 })).toEqual([1, 2]);
    expect(Object.fromEntries([["a", 1]])).toEqual({ a: 1 });
    expect(["a", ["b"]].flat()).toEqual(["a", "b"]);
    expect(typeof Object.getOwnPropertyDescriptors({ a: 1 }).a).toBe("object");
    expect("  x".trimStart()).toBe("x");
    expect("a".padStart(3, "0")).toBe("00a");
    expect("a".padEnd(3, "0")).toBe("a00");
    expect((5).toString(16).padStart(2, "0")).toBe("05");
    expect("ab".includes("b")).toBe(true);
    expect(Number.isInteger(3)).toBe(true);
    expect(Math.trunc(-1.5)).toBe(-1);
    if (typeof NodeList !== "undefined") expect(typeof NodeList.prototype[Symbol.iterator]).toBe("function");
  });
  it("strips the player query so exit lands on the catalog page", () => {
    expect(catalogHref("https://example.com/flymrp/main.html?game=扫雷.mrp")).toBe("https://example.com/flymrp/index.html");
    expect(catalogHref("app://flymrp/main.html?local=games/a.mrp#x")).toBe("app://flymrp/index.html");
  });
  it("installs user MRP files into the catalog and launches them as local games", () => {
    expect(isMrpFilename("俄罗斯方块.mrp")).toBe(true);
    expect(isMrpFilename("/sdcard/games/box.MRP")).toBe(true);
    expect(isMrpFilename("save.dat")).toBe(false);
    const installed = installedGamesFromSd([
      { path: "music/a.mp3", bytes: { length: 8 } },
      { path: "games/my.mrp", bytes: { length: 128 } },
    ]);
    expect(installed).toEqual([{
      id: 10000,
      name: "games/my.mrp",
      title: "my",
      category: "我的游戏",
      size: 128,
      local: true,
    }]);
    expect(playerHref({ id: 1, name: "扫雷.mrp" }, "https://example.com/flymrp/index.html")).toBe("https://example.com/flymrp/main.html?game=%E6%89%AB%E9%9B%B7.mrp");
    expect(playerHref({ id: 10000, name: "games/my.mrp", local: true }, "https://example.com/flymrp/index.html")).toBe("https://example.com/flymrp/main.html?local=games%2Fmy.mrp");
  });
});
