import { describe, expect, it } from "vitest";
import { LuaRuntimeError } from "../../src/err/errors.ts";
import { MR_IGNORE, MR_STATE_PAUSE, MR_STATE_RUN, MythroadRuntime } from "../../src/mythroad/index.ts";

describe("5-C timer/event compatibility", () => {
  it("one-shot does not repeat", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    let n = 0;
    rt.lua.register("dealtimer", () => {
      n++;
      return 0;
    });
    rt.timers.start(0, 5, "dealtimer", 1);
    rt.advance(5);
    rt.step();
    rt.advance(5);
    expect(rt.step()).toBe(false);
    expect(n).toBe(1);
  });

  it("callback restarts timer", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    let n = 0;
    rt.lua.register("dealtimer", () => {
      n++;
      if (n < 3) rt.timers.start(rt.clock, 1, "dealtimer", rt.state);
      return 0;
    });
    rt.timers.start(0, 1, "dealtimer", 1);
    rt.advance(1);
    rt.step();
    rt.advance(1);
    rt.step();
    rt.advance(1);
    rt.step();
    expect(n).toBe(3);
  });

  it("event then timer order is queue order", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    const seq: string[] = [];
    rt.lua.register("dealevent", () => {
      seq.push("e");
      return 0;
    });
    rt.lua.register("dealtimer", () => {
      seq.push("t");
      return 0;
    });
    rt.queueEvent(4, 0, 0, 0);
    rt.timers.start(0, 0, "dealtimer", 1);
    rt.advance(0);
    rt.step();
    rt.step();
    expect(seq).toEqual(["e", "t"]);
  });

  it("nested callback from event", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    let n = 0;
    rt.lua.register("dealevent", () => {
      n++;
      rt.lua.callGlobal("inner");
      return 0;
    });
    rt.lua.register("inner", () => {
      n += 10;
      return 0;
    });
    rt.queueEvent(4, 1, 0, 0);
    rt.step();
    expect(n).toBe(11);
  });

  it("exit during timer callback", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    rt.lua.register("dealtimer", () => {
      const ex = rt.lua.L.getGlobal("Exit");
      const f = rt.lua.L.top;
      rt.lua.L.setFn(f, ex.num);
      rt.lua.L.top = f + 1;
      rt.lua.pcall(0);
      return 0;
    });
    rt.timers.start(0, 1, "dealtimer", 1);
    rt.advance(1);
    expect(() => rt.step()).toThrow(LuaRuntimeError);
    expect(rt.exited).toBe(true);
  });

  it("suspend then resume event ignored while pause without flag", () => {
    const rt = new MythroadRuntime();
    rt.state = MR_STATE_RUN;
    let n = 0;
    rt.lua.register("dealevent", () => {
      n++;
      return 0;
    });
    rt.pause();
    expect(rt.state).toBe(MR_STATE_PAUSE);
    rt.queueEvent(4, 0, 0, 0);
    expect(rt.dispatchEvent(rt.pollEvent()!)).toBe(MR_IGNORE);
    expect(n).toBe(0);
    rt.resume();
    rt.queueEvent(4, 0, 0, 0);
    rt.step();
    expect(n).toBe(1);
  });
});
