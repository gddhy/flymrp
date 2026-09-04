import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF, tableSlotIndex } from "../../src/abi/layout.ts";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MythroadRuntime, NullGraphicsBackend } from "../../src/mythroad/index.ts";
import { REAL_MRP_BASELINE, runRealMrpStartup } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
const REAL_SHA = "77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263";

describe("5-C.10G real MRP startup after table[17] sprintf_ %d", () => {
  it("REAL_EXECUTED table[17] writes res_lang0.rc, then stops at table[40]", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const r = runRealMrpStartup(bytes, { path: REAL_APP, consistencyRuns: 5 });

    expect(r.mrp.sha256).toBe(REAL_SHA);
    expect(r.mrp.package).toBe("gssjxz.mrp");
    expect(r.lua.realStartMrLoaded).toBe(true);
    expect(r.lua.exception?.isLuaVmError).toBe(false);
    expect(r.lua.exception?.message).toBe("UNKNOWN_REQUIRED_SLOT = 40");
    expect(r.lua.strCom.map((s) => [s.code, s.extra, s.ok])).toEqual([
      [601, 0, true],
      [800, 0, true],
      [801, 1, true],
      [800, 0, true],
      [801, 6, true],
      [801, 0, false],
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

    const h33 = r.mrTable.hits.find((h) => h.slot === 33);
    expect(h33?.status).toBe("REAL_EXECUTED");
    expect(h33?.pc).toBe(REAL_MRP_BASELINE.stub33);
    expect(h33?.return).toBe(0);
    expect(r.execution.table33Return).toBe(0);
    expect(r.execution.table33Store).toBe(0);
    expect(r.execution.init2Reached).toBe(false);
    expect(r.mrTable.hits.every((h) => h.status !== "FORENSIC_BYPASSED")).toBe(true);
    expect(r.mrTable.hits.map((h) => h.slot)).toEqual([25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40]);

    const h17 = r.mrTable.hits.find((h) => h.slot === 17);
    expect(h17?.status).toBe("REAL_EXECUTED");
    expect(h17?.pc).toBe(REAL_MRP_BASELINE.stub17);
    expect(h17?.arguments[0]).toBe(REAL_MRP_BASELINE.sprintfBuffer);
    expect(h17?.arguments[1]).toBe(REAL_MRP_BASELINE.sprintfFormat);
    expect(h17?.arguments[2]).toBe(0);
    expect(h17?.arguments[3]).toBe(REAL_MRP_BASELINE.stub17);
    expect(h17?.return).toBe(REAL_MRP_BASELINE.sprintfReturn);
    expect(r.execution.sprintfFilename).toBe(REAL_MRP_BASELINE.sprintfExpected);
    expect(r.execution.sprintfReturn).toBe(REAL_MRP_BASELINE.sprintfReturn);
    expect(r.execution.sprintfNulTerminated).toBe(true);
    expect(r.execution.sprintfBytes).toEqual([
      ...[...REAL_MRP_BASELINE.sprintfExpected].map((c) => c.charCodeAt(0)),
      0,
    ]);
    expect(r.execution.table17Count).toBe(1);
    expect(r.execution.table125After17).toBe(false);
    expect(r.vfs.reads.includes("res_lang0.rc")).toBe(false);

    expect(r.execution.consumer.reached).toBe(true);
    expect(r.execution.consumer.pc).toBe(REAL_MRP_BASELINE.consumer);
    expect(r.execution.consumer.r0).toBe(0);
    expect(r.execution.consumer.r1).toBe(REAL_MRP_BASELINE.sprintfBuffer);
    expect(r.execution.consumer.name).toBe(REAL_MRP_BASELINE.sprintfExpected);

    const h40 = r.mrTable.hits.find((h) => h.slot === 40);
    expect(h40?.status).toBe("NOT_EXECUTED");
    expect(h40?.pc).toBe(REAL_MRP_BASELINE.stub40);
    expect(h40?.arguments[0]).toBe(0x00200058);
    expect(h40?.arguments[1]).toBe(1);
    expect(h40?.arguments[2]).toBe(REAL_MRP_BASELINE.stub40);

    const bySlot = Object.fromEntries(r.mrTable.slots.map((s) => [s.slot, s]));
    expect(bySlot[130]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[38]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[33]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[17]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[17]!.guestReached).toBe(true);
    expect(bySlot[17]!.handlerPresent).toBe(true);
    expect(bySlot[40]!.status).toBe("NOT_EXECUTED");
    expect(bySlot[40]!.guestReached).toBe(true);
    expect(bySlot[40]!.handlerPresent).toBe(false);

    expect(r.mrTable.handlers).toEqual([
      { slot: 0, present: true },
      { slot: 14, present: true },
      { slot: 25, present: true },
      { slot: 125, present: true },
      { slot: 130, present: true },
      { slot: 38, present: true },
      { slot: 33, present: true },
      { slot: 17, present: true },
      { slot: 40, present: false },
    ]);

    expect(r.execution.cpu33?.pc).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.execution.cpu33?.r0).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.execution.cpu33?.lr).toBe(0x01ea7cf7);

    expect(r.execution.cpu17?.pc).toBe(REAL_MRP_BASELINE.stub17);
    expect(r.execution.cpu17?.r0).toBe(REAL_MRP_BASELINE.sprintfBuffer);
    expect(r.execution.cpu17?.r1).toBe(REAL_MRP_BASELINE.sprintfFormat);
    expect(r.execution.cpu17?.r2).toBe(0);
    expect(r.execution.cpu17?.r3).toBe(REAL_MRP_BASELINE.stub17);
    expect(r.execution.cpu17?.insnCount).toBe(183);

    expect(r.execution.cpu?.pc).toBe(REAL_MRP_BASELINE.stub40);
    expect(r.execution.cpu?.r0).toBe(0x00200058);
    expect(r.execution.cpu?.r1).toBe(1);
    expect(r.execution.cpu?.r2).toBe(REAL_MRP_BASELINE.stub40);
    expect(r.execution.cpu?.r3).toBe(0x01e7ff6c);
    expect(r.execution.cpu?.r5).toBe(0x00200058);
    expect(r.execution.cpu?.r6).toBe(REAL_MRP_BASELINE.sprintfBuffer);
    expect(r.execution.cpu?.r7).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.r9).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.lr).toBe(0x01ea89e7);
    expect(r.execution.cpu?.sp).toBe(0x01e7ff00);
    expect(r.execution.cpu?.cpsr).toBe(0x00000010);
    expect(r.execution.cpu?.insnCount).toBe(221);

    expect(r.stop.reason).toBe("UNKNOWN_REQUIRED_SLOT = 40");
    expect(r.stop.slot).toBe(40);
    expect(r.stop.pc).toBe(REAL_MRP_BASELINE.stub40);
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
      ["table33", "PASS"],
      ["table17", "PASS"],
      ["table40", "BLOCKED"],
    ]);

    expect(r.baseline.deterministic).toBe(true);
    expect(r.baseline.firstProductionBlocker).toBe("table[40]");
    expect(r.baseline.firstPost130Blocker).toBe("table[40]");
    expect(r.forensicPrior.table130).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table38).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table33).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table17).toBe("REAL_EXECUTED");
    expect(r.consistency.runs).toBe(5);
    expect(r.consistency.mismatches).toEqual([]);
    const fp = r.consistency.fingerprints[0]!;
    expect(fp.firstUnknownSlot).toBe(40);
    expect(fp.stopPc).toBe(REAL_MRP_BASELINE.stub40);
    expect(fp.armInsnCount).toBe(221);
    expect(fp.luaInsnCount).toBe(71);
    expect(fp.tableSlots).toEqual([25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40]);
    expect(fp.table33Return).toBe(0);
    expect(fp.erRwPlus4358).toBe(0);
    expect(fp.sprintfFilename).toBe(REAL_MRP_BASELINE.sprintfExpected);
    expect(r.stage5d).toBe("NOT STARTED");
  });

  it("advance(N) before start stores N at ER_RW+0x4358 without changing baseline order", () => {
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const rt = new MythroadRuntime({ graphics: new NullGraphicsBackend(), abiMode: "strict" });
    expect(rt.clock).toBe(0);
    rt.loadMrp(bytes);
    rt.advance(1234);
    expect(rt.clock).toBe(1234);
    try {
      rt.start("start.mr");
      throw new Error("should stop");
    } catch (e) {
      expect(e).toMatchObject({ message: "UNKNOWN_REQUIRED_SLOT = 40" });
    }
    expect(rt.unknownRequiredSlot).toBe(40);
    const p = rt.ext!.owners.wrapper.p >>> 0;
    const erRw = rt.ext!.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0;
    expect(rt.ext!.mem.read32(erRw + REAL_MRP_BASELINE.getTimeErOff) >>> 0).toBe(1234);
  });

  it("poisoned ER_RW+0x4358 is overwritten by getTime 0, proving the STR ran", () => {
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const rt = new MythroadRuntime({ graphics: new NullGraphicsBackend(), abiMode: "strict" });
    const origBind = rt.bindExt.bind(rt);
    rt.bindExt = (ext) => {
      origBind(ext);
      const e = rt.ext;
      if (!e) return;
      const origD = e.table.dispatch.bind(e.table);
      e.table.dispatch = (c, mem, pc) => {
        if (tableSlotIndex(pc) === 33) {
          const p = e.owners.wrapper.p >>> 0;
          const erRw = e.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0;
          e.mem.write32(erRw + REAL_MRP_BASELINE.getTimeErOff, 0xdeadbeef);
        }
        origD(c, mem, pc);
      };
    };
    try {
      rt.loadMrp(bytes);
      rt.start("start.mr");
    } catch {
      /* UNKNOWN 40 */
    }
    const p = rt.ext!.owners.wrapper.p >>> 0;
    const erRw = rt.ext!.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0;
    expect(rt.ext!.mem.read32(erRw + REAL_MRP_BASELINE.getTimeErOff) >>> 0).toBe(0);
    expect(rt.unknownRequiredSlot).toBe(40);
  });
});
