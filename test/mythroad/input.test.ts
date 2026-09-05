import { describe, expect, it } from "vitest";
import { EventError } from "../../src/err/errors.ts";
import {
  EV_KEY,
  MR_KEY_BACK,
  MR_KEY_DOWN,
  MR_KEY_FIRE,
  MR_KEY_LEFT,
  MR_KEY_PRESS,
  MR_KEY_RELEASE,
  MR_KEY_RIGHT,
  MR_KEY_SOFTLEFT,
  MR_KEY_SOFTRIGHT,
  MR_KEY_UP,
  MythroadRuntime,
} from "../../src/mythroad/index.ts";

describe("5-B synthetic input", () => {
  it("UP/DOWN/LEFT/RIGHT codes", () => {
    const rt = new MythroadRuntime();
    rt.input.press("UP");
    rt.input.press("DOWN");
    rt.input.press("LEFT");
    rt.input.press("RIGHT");
    expect(rt.pollEvent()).toMatchObject({ kind: EV_KEY, type: MR_KEY_PRESS, p1: MR_KEY_UP });
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_DOWN);
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_LEFT);
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_RIGHT);
  });

  it("FIRE is SELECT", () => {
    const rt = new MythroadRuntime();
    rt.input.press("FIRE");
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_FIRE);
  });

  it("BACK is SOFTRIGHT", () => {
    const rt = new MythroadRuntime();
    rt.input.press("BACK");
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_BACK);
    expect(MR_KEY_BACK).toBe(MR_KEY_SOFTRIGHT);
  });

  it("SOFTLEFT/SOFTRIGHT aliases", () => {
    const rt = new MythroadRuntime();
    rt.input.press("SOFTLEFT");
    rt.input.press("SOFTRIGHT");
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_SOFTLEFT);
    expect(rt.pollEvent()!.p1).toBe(MR_KEY_SOFTRIGHT);
  });

  it("release is KEY_RELEASE", () => {
    const rt = new MythroadRuntime();
    rt.input.release("UP");
    expect(rt.pollEvent()).toMatchObject({ type: MR_KEY_RELEASE, p1: MR_KEY_UP });
  });

  it("unknown key is EventError", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.input.press("NOPE")).toThrow(EventError);
  });

  it("input → dealevent", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    let key = -1;
    rt.lua.register("dealevent", (L) => {
      key = L.optNumber(2, -1);
      return 0;
    });
    rt.input.press("FIRE");
    rt.step();
    expect(key).toBe(MR_KEY_FIRE);
  });
});
