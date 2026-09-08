import { describe, expect, it } from "vitest";
import { classifyKaiOSKey, detectKaiOS } from "../../web/kaios.ts";
import { installKaiOSPolyfills } from "../../web/kaios-polyfill.ts";
import { DOM_KEY } from "../../web/controls.ts";

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
  it("installs missing ES2022 helpers without changing existing implementations", () => {
    installKaiOSPolyfills();
    expect([1, 2, 3].at(-1)).toBe(3);
    expect(Object.fromEntries([["a", 1]])).toEqual({ a: 1 });
    expect(["a", ["b"]].flat()).toEqual(["a", "b"]);
  });
});
