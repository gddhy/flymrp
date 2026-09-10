import { describe, expect, it } from "vitest";
import { TimerError } from "../../src/err/errors.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  OP_CALL,
  OP_GETGLOBAL,
  OP_LOADK,
} from "../../src/lua/index.ts";
import {
  MR_TIMER_STATE_IDLE,
  MR_TIMER_STATE_RUNNING,
  MR_TIMER_STATE_SUSPENDED,
  MythroadRuntime,
} from "../../src/mythroad/index.ts";
import { kn, ks, proto } from "../helpers/lua.ts";

describe("5-B timer", () => {
  it("TimerStart sets RUNNING", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.lua.runCold(
      proto({
        maxstack: 6,
        k: [ks("TimerStart"), kn(0), kn(20), ks("dealtimer")],
        code: [
          CREATE_ABx(OP_GETGLOBAL, 0, 0),
          CREATE_ABx(OP_LOADK, 1, 1),
          CREATE_ABx(OP_LOADK, 2, 2),
          CREATE_ABx(OP_LOADK, 3, 3),
          CREATE_ABC(OP_CALL, 0, 4, 1),
        ],
      }),
    );
    expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
    expect(rt.timers.interval).toBe(20);
    expect(rt.timers.callback).toBe("dealtimer");
  });

  it("TimerStop → IDLE", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.timers.start(0, 10, "dealtimer", 1);
    rt.lua.runCold(
      proto({
        maxstack: 3,
        k: [ks("TimerStop"), kn(0)],
        code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABx(OP_LOADK, 1, 1), CREATE_ABC(OP_CALL, 0, 2, 1)],
      }),
    );
    expect(rt.timers.state).toBe(MR_TIMER_STATE_IDLE);
  });

  it("advance below interval does not fire", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.timers.start(0, 50, "dealtimer", 1);
    rt.advance(49);
    expect(rt.events.count).toBe(0);
    expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
  });

  it("advance fires one-shot and goes IDLE", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.timers.start(0, 10, "dealtimer", 1);
    rt.advance(10);
    expect(rt.events.count).toBe(1);
    expect(rt.timers.state).toBe(MR_TIMER_STATE_IDLE);
  });

  it("timer → Lua callback via step", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    let n = 0;
    rt.lua.register("dealtimer", () => {
      n++;
      return 0;
    });
    rt.timers.start(0, 5, "dealtimer", 1);
    rt.advance(5);
    expect(rt.step()).toBe(true);
    expect(n).toBe(1);
  });

  it("repeat is re-arm from callback", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    let n = 0;
    rt.lua.register("dealtimer", () => {
      n++;
      rt.timers.start(rt.clock, 5, "dealtimer", rt.state);
      return 0;
    });
    rt.timers.start(0, 5, "dealtimer", 1);
    rt.advance(5);
    rt.step();
    rt.advance(5);
    rt.step();
    expect(n).toBe(2);
  });

  it("unexpected fire after stop is not queued", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.timers.start(0, 5, "dealtimer", 1);
    rt.timers.stop();
    rt.advance(5);
    expect(rt.events.count).toBe(0);
  });

  it("pause suspends timer; resume rearms 300ms", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.timers.start(0, 5, "dealtimer", 1);
    rt.pause();
    expect(rt.timers.state).toBe(MR_TIMER_STATE_SUSPENDED);
    rt.resume();
    expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
    expect(rt.timers.deadline).toBe(rt.clock + 300);
  });

  it("interval > uint16 throws TimerError", () => {
    const rt = new MythroadRuntime();
    expect(() => rt.timers.start(0, 70000, "x", 1)).toThrow(TimerError);
  });

  it("TimerStart in IDLE state is no-op", () => {
    const rt = new MythroadRuntime();
    rt.state = 0;
    rt.timers.start(0, 10, "dealtimer", 0);
    expect(rt.timers.state).toBe(MR_TIMER_STATE_IDLE);
  });

  it("runWithoutPause allows start while PAUSE", () => {
    const rt = new MythroadRuntime();
    rt.state = 2;
    rt.timers.runWithoutPause = 1;
    expect(rt.timers.start(0, 8, "dealtimer", 2)).toBe(true);
    expect(rt.timers.state).toBe(MR_TIMER_STATE_RUNNING);
  });
});
