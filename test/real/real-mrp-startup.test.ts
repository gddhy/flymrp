import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF, tableSlotIndex } from "../../src/abi/layout.ts";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MythroadRuntime, NullGraphicsBackend } from "../../src/mythroad/index.ts";
import { REAL_MRP_BASELINE, runRealMrpStartup } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
const REAL_SHA = "77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263";

describe("5-C.10E real MRP startup after table[33] mr_getTime", () => {
  it("REAL_EXECUTED table[33] via runtime.clock, stores ER_RW+0x4358, then stops at table[17]", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const r = runRealMrpStartup(bytes, { path: REAL_APP, consistencyRuns: 5 });

    expect(r.mrp.sha256).toBe(REAL_SHA);
    expect(r.mrp.package).toBe("gssjxz.mrp");
    expect(r.lua.realStartMrLoaded).toBe(true);
    expect(r.lua.exception?.isLuaVmError).toBe(false);
    expect(r.lua.exception?.message).toBe("UNKNOWN_REQUIRED_SLOT = 17");
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
    expect(r.mrTable.hits.map((h) => h.slot)).toEqual([25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17]);

    const h17 = r.mrTable.hits.find((h) => h.slot === 17);
    expect(h17?.status).toBe("NOT_EXECUTED");
    expect(h17?.pc).toBe(REAL_MRP_BASELINE.stub17);
    expect(h17?.arguments[0]).toBe(0x01e7ff74);
    expect(h17?.arguments[1]).toBe(0x01eaf204);
    expect(h17?.arguments[2]).toBe(0);
    expect(h17?.arguments[3]).toBe(REAL_MRP_BASELINE.stub17);

    const bySlot = Object.fromEntries(r.mrTable.slots.map((s) => [s.slot, s]));
    expect(bySlot[130]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[38]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[33]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[33]!.guestReached).toBe(true);
    expect(bySlot[33]!.handlerPresent).toBe(true);
    expect(bySlot[17]!.status).toBe("NOT_EXECUTED");
    expect(bySlot[17]!.guestReached).toBe(true);
    expect(bySlot[17]!.handlerPresent).toBe(false);

    expect(r.mrTable.handlers).toEqual([
      { slot: 0, present: true },
      { slot: 14, present: true },
      { slot: 25, present: true },
      { slot: 125, present: true },
      { slot: 130, present: true },
      { slot: 38, present: true },
      { slot: 33, present: true },
      { slot: 17, present: false },
    ]);

    expect(r.execution.cpu33?.pc).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.execution.cpu33?.r0).toBe(REAL_MRP_BASELINE.stub33);
    expect(r.execution.cpu33?.lr).toBe(0x01ea7cf7);

    expect(r.execution.cpu?.pc).toBe(REAL_MRP_BASELINE.stub17);
    expect(r.execution.cpu?.r0).toBe(0x01e7ff74);
    expect(r.execution.cpu?.r1).toBe(0x01eaf204);
    expect(r.execution.cpu?.r2).toBe(0);
    expect(r.execution.cpu?.r3).toBe(REAL_MRP_BASELINE.stub17);
    expect(r.execution.cpu?.r6).toBe(0x0020202c);
    expect(r.execution.cpu?.r7).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.r9).toBe(REAL_MRP_BASELINE.erRw);
    expect(r.execution.cpu?.lr).toBe(0x01e9a883);
    expect(r.execution.cpu?.sp).toBe(0x01e7ff68);
    expect(r.execution.cpu?.cpsr).toBe(0x00000010);
    expect(r.execution.cpu?.insnCount).toBe(183);

    expect(r.stop.reason).toBe("UNKNOWN_REQUIRED_SLOT = 17");
    expect(r.stop.slot).toBe(17);
    expect(r.stop.pc).toBe(REAL_MRP_BASELINE.stub17);
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
      ["table17", "BLOCKED"],
    ]);

    expect(r.baseline.deterministic).toBe(true);
    expect(r.baseline.firstProductionBlocker).toBe("table[17]");
    expect(r.baseline.firstPost130Blocker).toBe("table[17]");
    expect(r.forensicPrior.table130).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table38).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table33).toBe("REAL_EXECUTED");
    expect(r.consistency.runs).toBe(5);
    expect(r.consistency.mismatches).toEqual([]);
    const fp = r.consistency.fingerprints[0]!;
    expect(fp.firstUnknownSlot).toBe(17);
    expect(fp.stopPc).toBe(REAL_MRP_BASELINE.stub17);
    expect(fp.armInsnCount).toBe(183);
    expect(fp.luaInsnCount).toBe(71);
    expect(fp.tableSlots).toEqual([25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17]);
    expect(fp.table33Return).toBe(0);
    expect(fp.erRwPlus4358).toBe(0);
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
      expect(e).toMatchObject({ message: "UNKNOWN_REQUIRED_SLOT = 17" });
    }
    expect(rt.unknownRequiredSlot).toBe(17);
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
      /* UNKNOWN 17 */
    }
    const p = rt.ext!.owners.wrapper.p >>> 0;
    const erRw = rt.ext!.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0;
    expect(rt.ext!.mem.read32(erRw + REAL_MRP_BASELINE.getTimeErOff) >>> 0).toBe(0);
    expect(rt.unknownRequiredSlot).toBe(17);
  });
});
