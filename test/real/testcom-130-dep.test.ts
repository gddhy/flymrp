import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { TESTCOM130 } from "../../src/real/testcom130.ts";
import { TESTCOM130_DEP, runTestCom130DepForensics } from "../../src/real/testcom130dep.ts";
import { UNKNOWN_SLOT_35_THROWN } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");

describe("5-C.7 table[130] return-value dependence", () => {
  it("both return paths resume the same helper PC; 0x270d consumers are off this init CFG", () => {
    const r = runTestCom130DepForensics(new Uint8Array(readFileSync(REAL_APP)));

    expect(r.handlerPresent).toBe(true);
    expect(r.thrown).toBe(UNKNOWN_SLOT_35_THROWN);

    expect(r.encodings.cmp).toBe(TESTCOM130.enc.cmpR0R5);
    expect(r.encodings.bne).toBe(TESTCOM130.enc.bne);
    expect(r.encodings.sub2).toBe(TESTCOM130.enc.sub2);
    expect(r.encodings.str).toBe(TESTCOM130.enc.strR4_18);

    expect(r.pathA.resume).toBe(TESTCOM130_DEP.helperResume);
    expect(r.pathB.resume).toBe(TESTCOM130_DEP.helperResume);
    expect(r.pathA.writesErRw1c).toBe(false);
    expect(r.pathB.writesErRw1c).toBe(true);
    expect(r.pathB.stored).toBe(0x270d);

    expect(r.helperAfter.bl1).toBe(0x01ea7f68);
    expect(r.helperAfter.bl2).toBe(0x01ea9254);
    expect(r.r0ConsumedByNextBl).toBe(false);

    expect(r.literals270f).toEqual([0x01e9cf78]);
    expect(r.literals270d).toEqual([0x01ea6f80, 0x01ea73a0, 0x01ea7544]);
    expect(r.consumers).toHaveLength(3);
    expect(r.consumers.every((c) => c.erOff === 0x1c && c.cmpImm === 0x270d)).toBe(true);
    expect(r.consumerBlFromInit).toBe(false);
  });

  it("does not register table[38] on a fresh runtime", () => {
    const rt = new MythroadRuntime();
    expect(rt.ext).toBeNull();
  });
});
