import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { GSSJXZ_FP, runPlayablePath } from "../../src/real/playable.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");

describe("5-D.1 real MRP playable path", () => {
  it("title FIRE reaches map and DOWN changes the frame", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const rt = new MythroadRuntime({ abiMode: "strict" });
    rt.loadMrp(new Uint8Array(readFileSync(REAL_APP)));
    const r = runPlayablePath(rt);

    expect(r.failure).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.unknownRequiredSlot).toBeNull();
    expect(r.soundDialog).toBe(true);
    expect(r.titleScreen).toBe(true);
    expect(r.startGame).toBe(true);
    expect(r.gameplayFrame).toBe(true);
    expect(r.gameplayInput).toBe(true);

    expect(r.fingerprints.soundDialog).toBe(GSSJXZ_FP.soundDialog);
    expect(r.fingerprints.title).toBe(GSSJXZ_FP.title);
    expect(r.fingerprints.intro).toBe(GSSJXZ_FP.intro);
    expect(r.fingerprints.gameplay).toBe(GSSJXZ_FP.gameplay);
    expect(r.fingerprints.afterInput).not.toBe(r.fingerprints.gameplay);
    expect(r.frames.toSoundDialog).toBeLessThanOrEqual(48);
    expect(r.inputSequence).toEqual([
      "SOFTRIGHT press",
      "SOFTRIGHT release",
      "FIRE press",
      "FIRE release",
      "FIRE press",
      "FIRE release",
      "DOWN press",
      "DOWN release",
    ]);

    const code0 = r.calls.find((c) => c.code === 0);
    expect(code0?.kind).toBe("return");
    expect(code0?.r0).toBe(0);
    expect(code0?.insn).toBe(1_596_592);

    const extract = r.calls.find((c) => c.code === 1 && c.insn > 1_000_000);
    expect(extract?.kind).toBe("return");
    expect(extract?.r0).toBe(0);
    expect(extract?.insn).toBe(5_096_611);

    expect(r.calls.every((c) => c.kind === "return")).toBe(true);
    expect(rt.mrTable?.lastPlatDrawChar).not.toBeNull();
    expect(rt.mrTable?.lastStopSound).toEqual({ type: 0 });
  });
});
