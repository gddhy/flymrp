import { describe, expect, it } from "vitest";
import { IMPLEMENTED_A, IMPLEMENTED_B, MR_KEY_DOWN, MR_KEY_FIRE, MR_KEY_SELECT, MR_VERSION } from "../../src/mythroad/index.ts";

describe("5-B API inventory", () => {
  it("A list is non-empty and documented", () => {
    expect(IMPLEMENTED_A.length).toBeGreaterThanOrEqual(20);
    expect(IMPLEMENTED_A).toContain("GetSysInfo");
    expect(IMPLEMENTED_A).toContain("_strCom/801");
    expect(IMPLEMENTED_A).toContain("TimerStart");
  });

  it("B list covers VFS and datetime", () => {
    expect(IMPLEMENTED_B.length).toBeGreaterThanOrEqual(15);
    expect(IMPLEMENTED_B).toContain("file.open");
    expect(IMPLEMENTED_B).toContain("GetDatetime");
    expect(IMPLEMENTED_B).toContain("_strCom/602");
  });

  it("FULL vmver is 1968 not mini 2011", () => {
    expect(MR_VERSION).toBe(1968);
  });

  it("FIRE alias is SELECT", () => {
    expect(MR_KEY_FIRE).toBe(MR_KEY_SELECT);
    expect(MR_KEY_SELECT).toBe(20);
  });

  it("key DOWN is 13", () => {
    expect(MR_KEY_DOWN).toBe(13);
  });

  it("no Canvas/WebAudio/network in A/B names", () => {
    const all = [...IMPLEMENTED_A, ...IMPLEMENTED_B].join(" ");
    expect(all).not.toMatch(/Canvas|WebAudio|socket|_initNet/i);
  });

  it("strCom A codes are the confirmed EXT subset", () => {
    expect(IMPLEMENTED_A.filter((n) => n.startsWith("_strCom")).sort()).toEqual([
      "_strCom/601",
      "_strCom/800",
      "_strCom/801",
      "_strCom/802",
    ]);
  });

  it("timer APIs are start/stop not setTimeout", () => {
    expect(IMPLEMENTED_A).toContain("TimerStart");
    expect(IMPLEMENTED_A).toContain("TimerStop");
    expect(IMPLEMENTED_A).toContain("advance");
  });

  it("event loop APIs are step/mr_event not while-true", () => {
    expect(IMPLEMENTED_A).toContain("step");
    expect(IMPLEMENTED_A).toContain("mr_event");
    expect(IMPLEMENTED_A).toContain("dealevent");
  });

  it("inventory totals are stable for regression", () => {
    expect(IMPLEMENTED_A.length).toBe(29);
    expect(IMPLEMENTED_B.length).toBe(26);
  });

  it("graphics A subset is recordable stubs", () => {
    expect(IMPLEMENTED_A).toContain("_drawText");
    expect(IMPLEMENTED_A).toContain("_dispUp");
  });
});
