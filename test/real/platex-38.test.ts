import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { PLATEX38, runPlatex38Forensics } from "../../src/real/platex38.ts";
import { UNKNOWN_SLOT_122_THROWN } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");

describe("5-C.9 table[38] / asm_mr_platEx forensics", () => {
  it("this init call is 6-arg platEx(0x4c6,0,0,0,0,0); return unused; next BL is slot 33 wrapper", () => {
    const r = runPlatex38Forensics(new Uint8Array(readFileSync(REAL_APP)));

    expect(r.handler130).toBe(true);
    expect(r.handler38).toBe(true);
    expect(r.handler33).toBe(true);
    expect(r.productionThrown).toBe(UNKNOWN_SLOT_122_THROWN);
    expect(r.probeThrown).toBe(UNKNOWN_SLOT_122_THROWN);
    expect(r.skipped130With).toBe(0);
    expect(r.init2Reached).toBe(false);

    expect(r.encodings.bne).toBe(PLATEX38.enc.bne);
    expect(r.encodings.pathALitLoad).toBe(PLATEX38.enc.pathALitLoad);
    expect(r.encodings.pathABlx).toBe(PLATEX38.enc.pathABlx);
    expect(r.encodings.addSp).toBe(PLATEX38.enc.addSp);
    expect(r.encodings.pop).toBe(PLATEX38.enc.pop);
    expect(r.encodings.callerMov0).toBe(PLATEX38.enc.callerMov0);
    expect(r.encodings.slot33Blx).toBe(PLATEX38.enc.slot33Blx);
    expect(r.encodings.lit4c6).toBe(PLATEX38.codeA);
    expect(r.encodings.lit4c7).toBe(PLATEX38.codeB);

    expect(r.literals4c6).toEqual([PLATEX38.lit4c6]);
    expect(r.hit.r0).toBe(PLATEX38.codeA);
    expect(r.hit.r1).toBe(0);
    expect(r.hit.r2).toBe(0);
    expect(r.hit.r3).toBe(0);
    expect(r.hit.stack0).toBe(0);
    expect(r.hit.stack4).toBe(0);
    expect(r.hit.spAlign8).toBe(true);
    expect(r.hit.stack12).toBe(0x01ea7f77);
    expect(r.hit.lr).toBe(0x01ea666d);

    expect(r.nextBlAfter38).toBe(PLATEX38.slot33Fn);
    expect(r.callsites.filter((c) => c.onInitCfg)).toHaveLength(1);
    expect(r.callsites[0]!.blx).toBe(PLATEX38.pathABlx);
  });

  it("does not register table[38] or table[33]", () => {
    const rt = new MythroadRuntime();
    expect(rt.ext).toBeNull();
  });
});
