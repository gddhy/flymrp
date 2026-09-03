import { describe, expect, it } from "vitest";
import { EventError } from "../../src/err/errors.ts";
import {
  EV_CUSTOM,
  EV_KEY,
  EV_SYSTEM,
  EV_TIMER,
  EventQueue,
  MR_EXIT_EVENT,
  MR_IGNORE,
  MR_KEY_PRESS,
  MR_KEY_UP,
  MR_SUCCESS,
  MythroadRuntime,
} from "../../src/mythroad/index.ts";

describe("5-B event queue", () => {
  it("queue then poll FIFO", () => {
    const q = new EventQueue();
    q.queue(EV_KEY, 0, 12, 0);
    q.queue(EV_SYSTEM, 8, 0, 0);
    expect(q.poll()!.p1).toBe(12);
    expect(q.poll()!.type).toBe(8);
    expect(q.poll()).toBeNull();
  });

  it("full queue throws EventError", () => {
    const q = new EventQueue();
    for (let i = 0; i < 64; i++) q.queue(EV_CUSTOM, i, 0, 0);
    expect(() => q.queue(EV_CUSTOM, 0, 0, 0)).toThrow(EventError);
  });

  it("step with empty queue is false", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    expect(rt.step()).toBe(false);
  });

  it("event → Lua dealevent", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    const got: number[] = [];
    rt.lua.register("dealevent", (L) => {
      got.push(L.optNumber(1, -1), L.optNumber(2, -1), L.optNumber(3, -1));
      return 0;
    });
    rt.queueEvent(EV_KEY, MR_KEY_PRESS, MR_KEY_UP, 0);
    expect(rt.step()).toBe(true);
    expect(got).toEqual([MR_KEY_PRESS, MR_KEY_UP, 0]);
  });

  it("SYSTEM EXIT_EVENT reaches dealevent", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    let t = -1;
    rt.lua.register("dealevent", (L) => {
      t = L.optNumber(1, -1);
      return 0;
    });
    rt.queueEvent(EV_SYSTEM, MR_EXIT_EVENT, 0, 0);
    rt.step();
    expect(t).toBe(MR_EXIT_EVENT);
  });

  it("CUSTOM is dispatched as mr_event type", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    let t = -1;
    rt.lua.register("dealevent", (L) => {
      t = L.optNumber(1, -1);
      return 0;
    });
    rt.queueEvent(EV_CUSTOM, 99, 1, 2);
    rt.step();
    expect(t).toBe(99);
  });

  it("no dealevent and no EXT → IGNORE", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    expect(rt.dispatchEvent({ kind: EV_KEY, type: 0, p1: 12, p2: 0 })).toBe(MR_IGNORE);
  });

  it("IDLE state ignores events", () => {
    const rt = new MythroadRuntime();
    rt.state = 0;
    rt.lua.register("dealevent", () => 0);
    expect(rt.dispatchEvent({ kind: EV_KEY, type: 0, p1: 1, p2: 0 })).toBe(MR_IGNORE);
  });

  it("queueEvent + pollEvent", () => {
    const rt = new MythroadRuntime();
    rt.queueEvent(EV_TIMER, 0, 0, 0);
    const ev = rt.pollEvent();
    expect(ev!.kind).toBe(EV_TIMER);
    expect(rt.pollEvent()).toBeNull();
  });

  it("step does not scan per opcode", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    let n = 0;
    rt.lua.register("dealevent", () => {
      n++;
      return 0;
    });
    rt.queueEvent(EV_KEY, 0, 1, 0);
    rt.queueEvent(EV_KEY, 0, 2, 0);
    expect(rt.step()).toBe(true);
    expect(n).toBe(1);
    expect(rt.step()).toBe(true);
    expect(n).toBe(2);
  });

  it("dispatch success code", () => {
    const rt = new MythroadRuntime();
    rt.state = 1;
    rt.lua.register("dealevent", () => 0);
    expect(rt.dispatchEvent({ kind: EV_KEY, type: 0, p1: 12, p2: 0 })).toBe(MR_SUCCESS);
  });
});
