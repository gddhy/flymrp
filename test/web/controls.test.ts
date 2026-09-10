import { describe, expect, it } from "vitest";
import { DOM_KEY, HeldKeys } from "../../web/controls.ts";
import { resolveKey } from "../../src/mythroad/input.ts";
import { inferScreenSize } from "../../src/mythroad/device-size.ts";

describe("web player controls", () => {
  it("maps every digit to the phone digit instead of soft keys", () => {
    for (let i = 0; i < 10; i++) {
      expect(resolveKey(DOM_KEY[`Digit${i}`])).toBe(i);
      expect(resolveKey(DOM_KEY[`Numpad${i}`])).toBe(i);
    }
    expect(resolveKey("STAR")).toBe(10);
    expect(resolveKey("POUND")).toBe(11);
    expect(resolveKey(DOM_KEY.SoftLeft)).toBe(resolveKey("SOFTLEFT"));
    expect(resolveKey(DOM_KEY.SoftRight)).toBe(resolveKey("SOFTRIGHT"));
  });
  it("retains keys held by another keyboard or pointer source and releases on blur", () => {
    const events: string[] = [];
    const held = new HeldKeys(k => events.push(`+${k}`), k => events.push(`-${k}`));
    held.press("Enter", "FIRE"); held.press("Enter", "FIRE"); held.press("pointer1", "FIRE");
    held.release("Enter");
    expect(events).toEqual(["+FIRE"]);
    held.press("ArrowDown", "DOWN"); held.clear(); held.release("pointer1");
    expect(events).toEqual(["+FIRE", "+DOWN", "-FIRE", "-DOWN"]);
  });
  it("detects collection dimensions and lets an explicit filename override them", () => {
    expect(inferScreenSize("240×400游戏/g.mrp")).toEqual({ width: 240, height: 400 });
    expect(inferScreenSize("240×320游戏/拳霸480x320.mrp")).toEqual({ width: 480, height: 320 });
    expect(inferScreenSize("unknown.mrp")).toEqual({ width: 240, height: 320 });
  });
});
