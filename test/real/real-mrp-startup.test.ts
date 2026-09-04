import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MythroadRuntime } from "../../src/mythroad/index.ts";
import { REAL_MRP_BASELINE, runRealMrpStartup } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
const REAL_SHA = "77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263";

describe("5-C.10C real MRP startup after table[38] code 0x4c6", () => {
  it("REAL_EXECUTED table[38] 0x4c6, then stops at table[33] without implementing getTime", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const r = runRealMrpStartup(bytes, { path: REAL_APP, consistencyRuns: 5 });

    expect(r.mrp.sha256).toBe(REAL_SHA);
    expect(r.mrp.package).toBe("gssjxz.mrp");
    expect(r.lua.realStartMrLoaded).toBe(true);
    expect(r.lua.exception?.isLuaVmError).toBe(false);
    expect(r.lua.exception?.message).toBe("UNKNOWN_REQUIRED_SLOT = 33");
    expect(r.lua.strCom.map((s) => [s.code, s.extra, s.ok])).toEqual([
      [601, 0, true],
      [800, 0, true],
      [801, 1, true],
      [800, 0, true],
      [801, 6, true],
      [801, 0, false],
    ]);
    expect(r.lua.strCom801.map((s) => [s.extra, s.returnedToLua])).toEqual([
      [1, true],
      [6, true],
      [0, false],
    ]);

    expect(r.ext.p).toBe(REAL_MRP_BASELINE.p);
    expect(r.ext.helper).toBe(REAL_MRP_BASELINE.helper);
    expect(r.ext.erRw).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.ext.rwLen).toBe(REAL_MRP_BASELINE.rwLen);
    expect(r.ext.erRwPlus1c).toBe(REAL_MRP_BASELINE.erRw1cAfterCase7);

    const h130 = r.mrTable.hits.find((h) => h.slot === 130);
    expect(h130?.status).toBe("REAL_EXECUTED");
    expect(h130?.return).toBe(REAL_MRP_BASELINE.case7Input1);

    const h38 = r.mrTable.hits.find((h) => h.slot === 38);
    expect(h38?.status).toBe("REAL_EXECUTED");
    expect(h38?.return).toBe(MR_SUCCESS);
    expect(h38?.arguments).toEqual([REAL_MRP_BASELINE.platexCode, 0, 0, 0]);
    expect(h38?.pc).toBe(REAL_MRP_BASELINE.stub38);
    expect(r.mrTable.hits.every((h) => h.status !== "FORENSIC_BYPASSED")).toBe(true);
    expect(r.mrTable.hits.map((h) => h.slot)).toEqual([25, 0, 125, 25, 0, 14, 130, 14, 38, 33]);

    const h33 = r.mrTable.hits.find((h) => h.slot === 33);
    expect(h33?.status).toBe("NOT_EXECUTED");
    expect(h33?.pc).toBe(REAL_MRP_BASELINE.stub33);
    expect(h33?.arguments[0]).toBe(REAL_MRP_BASELINE.stub33);

    const bySlot = Object.fromEntries(r.mrTable.slots.map((s) => [s.slot, s]));
    expect(bySlot[130]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[38]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[38]!.guestReached).toBe(true);
    expect(bySlot[38]!.handlerPresent).toBe(true);
    expect(bySlot[33]!.status).toBe("NOT_EXECUTED");
    expect(bySlot[33]!.guestReached).toBe(true);
    expect(bySlot[33]!.handlerPresent).toBe(false);

    expect(r.mrTable.handlers).toEqual([
      { slot: 0, present: true },
      { slot: 14, present: true },
      { slot: 25, present: true },
      { slot: 125, present: true },
      { slot: 130, present: true },
      { slot: 38, present: true },
      { slot: 33, present: false },
    ]);

    expect(r.execution.cpu130?.pc).toBe(REAL_MRP_BASELINE.stub130);
    expect(r.execution.cpu38?.pc).toBe(REAL_MRP_BASELINE.stub38);
    expect(r.execution.cpu38?.r0).toBe(REAL_MRP_BASELINE.platexCode);
    expect(r.execution.cpu38?.r1).toBe(0);
    expect(r.execution.cpu38?.r2).toBe(0);
    expect(r.execution.cpu38?.r3).toBe(0);
    expect(r.execution.cpu38?.stack0).toBe(0);
    expect(r.execution.cpu38?.stack4).toBe(0);
    expect(r.execution.cpu38?.lr).toBe(0x01ea666d);
    expect(r.execution.table38Return).toBe(MR_SUCCESS);
    expect(r.execution.table38ReturnConsumer).toBe(
      "none / overwritten before use (next table[33] r0=0x00010084)",
    );

    expect(r.execution.cpu?.pc).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.execution.cpu?.r0).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.execution.cpu?.r1).toBe(0);
    expect(r.execution.cpu?.r2).toBe(0);
    expect(r.execution.cpu?.r3).toBe(0);
    expect(r.execution.cpu?.r4).toBe(0);
    expect(r.execution.cpu?.r5).toBe(0x002057d0);
    expect(r.execution.cpu?.r6).toBe(REAL_MRP_BASELINE.p);
    expect(r.execution.cpu?.r7).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.r8).toBe(0);
    expect(r.execution.cpu?.r9).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.lr).toBe(0x01ea7cf7);
    expect(r.execution.cpu?.sp).toBe(0x01e7ffa0);
    expect(r.execution.cpu?.cpsr).toBe(0x00000010);
    expect(r.execution.cpu?.insnCount).toBe(145);
    expect(r.execution.cpu?.stack0).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.stack4).toBe(0x01ea7f7b);

    expect(r.stop.reason).toBe("UNKNOWN_REQUIRED_SLOT = 33");
    expect(r.stop.slot).toBe(33);
    expect(r.stop.pc).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.stop.owner).toBe("gssjxz.mrp");

    expect(r.progress.map((p) => [p.stage, p.status])).toEqual([
      ["MRP parse", "PASS"],
      ["start.mr", "PASS"],
      ["mrc_loader.ext", "PASS"],
      ["cfunction.ext", "PASS"],
      ["cfunction init", "PASS"],
      ["code6", "PASS"],
      ["code0 entry", "PASS"],
      ["table130", "PASS"],
      ["table14 post-130", "PASS"],
      ["table38", "PASS"],
      ["table33", "BLOCKED"],
    ]);

    expect(r.baseline.deterministic).toBe(true);
    expect(r.baseline.firstProductionBlocker).toBe("table[33]");
    expect(r.baseline.firstPost130Blocker).toBe("table[33]");
    expect(r.forensicPrior.table130).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table38).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table33).toBe("NOT_EXECUTED");
    expect(r.consistency.runs).toBe(5);
    expect(r.consistency.mismatches).toEqual([]);
    const fp = r.consistency.fingerprints[0]!;
    expect(fp.firstUnknownSlot).toBe(33);
    expect(fp.stopPc).toBe(REAL_MRP_BASELINE.stub33);
    expect(fp.armInsnCount).toBe(145);
    expect(fp.luaInsnCount).toBe(71);
    expect(fp.tableSlots).toEqual([25, 0, 125, 25, 0, 14, 130, 14, 38, 33]);
    expect(r.stage5d).toBe("NOT STARTED");
  });

  it("fresh runtime has no ext until bind; table[33] stays unimplemented", () => {
    const rt = new MythroadRuntime();
    expect(rt.ext).toBeNull();
  });
});
