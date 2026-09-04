import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AEX_P_ER_RW_OFF, tableSlotIndex } from "../../src/abi/layout.ts";
import { MR_SUCCESS } from "../../src/mythroad/constants.ts";
import { MythroadRuntime, NullGraphicsBackend } from "../../src/mythroad/index.ts";
import { ARM_INSN_BUDGET_THROWN, REAL_MRP_BASELINE, runRealMrpStartup } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");
const REAL_SHA = "77487205cd4db95fcf104392d9cc692ab122b06f7a04e14f49899277d9ac4263";

const HITS_TO_FIRST_TABLE9 = [
  25, 0, 125, 25, 0, 14, 130, 14, 38, 33, 17, 40, 14, 44, 0, 45, 44, 0, 3, 3, 10, 3, 3, 10, 3, 3, 10, 3, 3, 1, 1, 0, 45, 44, 41, 9,
] as const;

describe("5-C.10P real MRP startup after memcmp2", () => {
  it("REAL_EXECUTED table9 memcmp2; gzip path; stops at ARM insn budget", () => {
    expect(existsSync(REAL_APP)).toBe(true);
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const r = runRealMrpStartup(bytes, { path: REAL_APP, consistencyRuns: 5 });

    expect(r.mrp.sha256).toBe(REAL_SHA);
    expect(r.mrp.package).toBe("gssjxz.mrp");
    expect(r.lua.realStartMrLoaded).toBe(true);
    expect(r.lua.exception?.isLuaVmError).toBe(false);
    expect(r.lua.exception?.message).toBe(ARM_INSN_BUDGET_THROWN);
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
    expect(r.mrTable.hits.map((h) => h.slot).slice(0, HITS_TO_FIRST_TABLE9.length)).toEqual([...HITS_TO_FIRST_TABLE9]);
    expect(r.mrTable.hits).toHaveLength(REAL_MRP_BASELINE.totalHitCount);
    expect(r.mrTable.hits[HITS_TO_FIRST_TABLE9.length]!.slot).toBe(9);
    expect(r.mrTable.hits.at(-1)!.slot).toBe(3);

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
    expect(h40?.status).toBe("REAL_EXECUTED");
    expect(h40?.pc).toBe(REAL_MRP_BASELINE.stub40);
    expect(h40?.arguments[0]).toBe(REAL_MRP_BASELINE.packFilenameAddr);
    expect(h40?.arguments[1]).toBe(1);
    expect(h40?.return).toBe(1);

    expect(r.ext.packFilenameAddr).toBe(REAL_MRP_BASELINE.packFilenameAddr);
    expect(r.ext.packFilenameBytes).toHaveLength(REAL_MRP_BASELINE.packFilenameBytes);
    expect(r.ext.packFilenameBeforeCode0).toBe(r.mrp.package);
    expect(r.execution.packFilenameAt40).toBe(r.mrp.package);
    expect(r.execution.packFilenameAt40).toBe(r.ext.packFilenameBeforeCode0);
    expect(r.execution.packFilenameAt40).not.toBe(REAL_MRP_BASELINE.sprintfExpected);
    expect(r.execution.packFilenameAt40).not.toBe("app.mrp");
    expect(r.ext.packFilenameBytes[r.mrp.package.length]).toBe(0);
    expect(r.ext.packFilenameBytes.slice(r.mrp.package.length + 1).every((b) => b === 0)).toBe(true);
    expect(r.mrTable.handlers.some((h) => h.slot === REAL_MRP_BASELINE.packFilenameSlot)).toBe(false);

    const bySlot = Object.fromEntries(r.mrTable.slots.map((s) => [s.slot, s]));
    expect(bySlot[130]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[38]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[33]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[17]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[17]!.guestReached).toBe(true);
    expect(bySlot[17]!.handlerPresent).toBe(true);
    expect(bySlot[40]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[40]!.guestReached).toBe(true);
    expect(bySlot[40]!.handlerPresent).toBe(true);
    expect(bySlot[44]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[45]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[41]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[41]!.guestReached).toBe(true);
    expect(bySlot[41]!.handlerPresent).toBe(true);
    expect(bySlot[3]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[3]!.guestReached).toBe(true);
    expect(bySlot[3]!.handlerPresent).toBe(true);
    expect(bySlot[10]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[10]!.guestReached).toBe(true);
    expect(bySlot[10]!.handlerPresent).toBe(true);
    expect(bySlot[1]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[1]!.guestReached).toBe(true);
    expect(bySlot[1]!.handlerPresent).toBe(true);
    expect(bySlot[9]!.status).toBe("REAL_EXECUTED");
    expect(bySlot[9]!.guestReached).toBe(true);
    expect(bySlot[9]!.handlerPresent).toBe(true);

    expect(r.mrTable.handlers).toEqual([
      { slot: 0, present: true },
      { slot: 14, present: true },
      { slot: 25, present: true },
      { slot: 125, present: true },
      { slot: 130, present: true },
      { slot: 38, present: true },
      { slot: 33, present: true },
      { slot: 17, present: true },
      { slot: 40, present: true },
      { slot: 44, present: true },
      { slot: 45, present: true },
      { slot: 41, present: true },
      { slot: 3, present: true },
      { slot: 10, present: true },
      { slot: 1, present: true },
      { slot: 9, present: true },
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

    expect(r.execution.cpu?.pc).toBe(REAL_MRP_BASELINE.budgetStopPc);
    expect(r.execution.cpu?.lr).toBe(REAL_MRP_BASELINE.budgetStopLr);
    expect(r.execution.cpu?.insnCount).toBe(REAL_MRP_BASELINE.insnBudget);

    expect(r.stop.reason).toBe(ARM_INSN_BUDGET_THROWN);
    expect(r.stop.slot).toBeNull();
    expect(r.stop.pc).toBe(REAL_MRP_BASELINE.budgetStopPc);
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
      ["table40", "PASS"],
      ["table44", "PASS"],
      ["table45", "PASS"],
      ["table41", "PASS"],
      ["table3", "PASS"],
      ["table10", "PASS"],
      ["table1", "PASS"],
      ["table9", "PASS"],
      ["guest inflate", "BLOCKED"],
    ]);

    expect(r.baseline.deterministic).toBe(true);
    expect(r.baseline.firstProductionBlocker).toBe("ARM_INSN_BUDGET");
    expect(r.baseline.firstPost130Blocker).toBe("ARM_INSN_BUDGET");
    expect(r.forensicPrior.table130).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table38).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table33).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table17).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table3).toBe("REAL_EXECUTED");
    expect(r.forensicPrior.table10).toBe("REAL_EXECUTED");
    expect(r.consistency.runs).toBe(5);
    expect(r.consistency.mismatches).toEqual([]);
    const fp = r.consistency.fingerprints[0]!;
    expect(fp.firstUnknownSlot).toBeNull();
    expect(fp.stopPc).toBe(REAL_MRP_BASELINE.budgetStopPc);
    expect(fp.armInsnCount).toBe(REAL_MRP_BASELINE.insnBudget);
    expect(fp.luaInsnCount).toBe(71);
    expect(fp.tableSlots.slice(0, HITS_TO_FIRST_TABLE9.length)).toEqual([...HITS_TO_FIRST_TABLE9]);
    expect(fp.tableSlots).toHaveLength(REAL_MRP_BASELINE.totalHitCount);
    expect(fp.memcmp9Ret).toBe(0);
    expect(fp.gzipPath).toBe(true);
    expect(fp.hitCount).toBe(REAL_MRP_BASELINE.totalHitCount);
    expect(fp.stopKind).toBe("abi-fault");
    expect(fp.table33Return).toBe(0);
    expect(fp.erRwPlus4358).toBe(0);
    expect(fp.sprintfFilename).toBe(REAL_MRP_BASELINE.sprintfExpected);
    expect(fp.packFilename).toBe(r.mrp.package);
    expect(fp.p).toBe(REAL_MRP_BASELINE.p);
    expect(fp.helper).toBe(REAL_MRP_BASELINE.helper);
    expect(fp.erRw).toBe(REAL_MRP_BASELINE.erRw);
    expect(fp.rwLen).toBe(REAL_MRP_BASELINE.rwLen);
    expect(fp.handleIds).toEqual([1]);
    expect(fp.readPositions).toEqual([16, 5736, 24239]);
    expect(fp.seekPositions).toEqual([240, 7065]);
    expect(fp.headerMatch).toBe(true);
    expect(fp.indexMatch).toBe(true);
    expect(fp.firstSeekNewPos).toBe(240);
    expect(fp.payloadDest).toBe(0x00206e6c);
    expect(fp.payloadMatch).toBe(true);
    expect(fp.closeRet).toBe(0);
    expect(r.stage5d).toBe("NOT STARTED");

    const hdr = r.execution.file.headerRead;
    expect(hdr).toBeTruthy();
    expect(hdr!.requested).toBe(16);
    expect(hdr!.returned).toBe(16);
    expect(hdr!.sourceOffset).toBe(0);
    expect(hdr!.match).toBe(true);
    expect(hdr!.guestBytes).toEqual([...bytes.subarray(0, 16)]);
    expect(hdr!.archiveBytes).toEqual([...bytes.subarray(0, 16)]);

    const sk = r.execution.file.firstSeek;
    expect(sk).toMatchObject({
      handle: 1,
      origin: REAL_MRP_BASELINE.firstSeekOrigin,
      offset: REAL_MRP_BASELINE.firstSeekOffset,
      oldPos: 16,
      newPos: REAL_MRP_BASELINE.listStart,
      ret: 0,
    });

    const idx = r.execution.file.indexRead;
    expect(idx).toBeTruthy();
    expect(idx!.requested).toBe(REAL_MRP_BASELINE.indexLen);
    expect(idx!.returned).toBe(REAL_MRP_BASELINE.indexLen);
    expect(idx!.sourceOffset).toBe(REAL_MRP_BASELINE.listStart);
    expect(idx!.match).toBe(true);
    expect(idx!.guestBytes).toEqual([...bytes.subarray(240, 256)]);

    const reads = r.mrTable.hits.filter((h) => h.slot === 44);
    expect(reads).toHaveLength(3);
    expect(reads[0]!.return).toBe(16);
    expect(reads[1]!.return).toBe(5496);
    expect(reads[2]!.return).toBe(17174);
    expect(reads[2]!.arguments[1]).toBe(0x00206e6c);
    expect(r.mrTable.hits.filter((h) => h.slot === 45).map((h) => h.return)).toEqual([0, 0]);
    expect(r.mrTable.hits.find((h) => h.slot === 41)?.return).toBe(0);
    expect(r.execution.file.reached41).toBe(true);
    expect(r.mrp.size).toBe(REAL_MRP_BASELINE.archiveBytes);

    const first3 = r.execution.memcpy3[0];
    expect(first3).toMatchObject({
      dst: 0x01e7ff34,
      src: 0x00205864,
      count: 4,
      ret: 0x01e7ff34,
    });
    expect(first3!.srcBytes.slice(0, 4)).toEqual([9, 0, 0, 0]);
    expect(first3!.dstBytes.slice(0, 4)).toEqual([9, 0, 0, 0]);

    const name3 = r.execution.memcpy3[1];
    expect(name3).toMatchObject({
      dst: 0x00206de4,
      src: 0x00205868,
      count: 9,
      ret: 0x00206de4,
    });
    expect(String.fromCharCode(...name3!.dstBytes.slice(0, 8))).toBe("start.mr");
    expect(name3!.dstBytes[8]).toBe(0);

    expect(r.execution.strcmp10).toEqual([
      { filename: "res_lang0.rc", tempName: "start.mr", ret: -1 },
      { filename: "res_lang0.rc", tempName: "mrc_loader.ext", ret: 1 },
      { filename: "res_lang0.rc", tempName: "res_lang0.rc", ret: 0 },
    ]);
    expect(r.execution.directory).toMatchObject({
      names: ["start.mr", "mrc_loader.ext", "res_lang0.rc"],
      visited: 3,
      matchedName: "res_lang0.rc",
      filePos: 7065,
      fileLen: 17174,
      archiveOffset: 7065,
      archiveLength: 17174,
      posLenMatch: true,
    });
    expect(r.execution.table1).toMatchObject({
      r0: 0x00206de0,
      r1: 132,
      headerWord: 128,
      userPtr: 0x00206de4,
      ret: 0,
      returnConsumer: "none",
    });
    expect(r.execution.table1?.registryMatch).toMatchObject({
      guestAddr: 0x00206de0,
      size: 132,
      alignedSize: 136,
      matchesR0: true,
      matchesLen: true,
      liveAfter: false,
    });
    expect(r.execution.table1Calls.length).toBeGreaterThanOrEqual(2);
    expect(r.execution.table1Calls[1]).toMatchObject({
      r0: 0x00205860,
      r1: 5500,
      headerWord: 5496,
      userPtr: 0x00205864,
      ret: 0,
    });
    expect(r.execution.table1Calls[1]?.registryMatch).toMatchObject({
      guestAddr: 0x00205860,
      size: 5500,
      alignedSize: 5504,
      matchesR0: true,
      matchesLen: true,
      liveAfter: false,
    });
    expect(r.execution.readFile).toMatchObject({
      name: "res_lang0.rc",
      filePos: 7065,
      fileLen: 17174,
      payloadAddr: 0x00206e6c,
      rawAlloc: 0x00206e68,
      payloadMatch: true,
      closed: true,
      closeRet: 0,
    });
    expect(r.execution.readFile?.payloadMatch).toBe(true);
    expect([...bytes.subarray(7065, 7065 + 16)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 0, 11, 237, 189, 121, 124, 147, 85]);
    expect(r.ext.calls.find((c) => c.code === 0)?.ok).toBe(false);
    expect(r.lua.strCom801.find((s) => s.extra === 0)?.returnedToLua).toBe(false);
    expect(r.lua.chunkReturned).toBe(false);
    const before9 = r.mrTable.hits.slice(0, HITS_TO_FIRST_TABLE9.length);
    expect(before9.filter((h) => h.slot === 3)).toHaveLength(8);
    expect(r.mrTable.hits.filter((h) => h.slot === 10)).toHaveLength(3);
    expect(r.mrTable.hits.filter((h) => h.slot === 9)).toHaveLength(2);
    expect(r.execution.table9).toMatchObject({
      r0: REAL_MRP_BASELINE.memcmp9R0,
      r1: REAL_MRP_BASELINE.memcmp9R1,
      r2: REAL_MRP_BASELINE.memcmp9N,
      bufA: [...REAL_MRP_BASELINE.gzipMagic],
      bufB: [...REAL_MRP_BASELINE.gzipMagic],
      ret: 0,
      equalPath: true,
    });
    expect(r.execution.table9Calls).toHaveLength(2);
    expect(r.execution.table9Calls[1]).toMatchObject({
      r1: REAL_MRP_BASELINE.memcmp9R1,
      r2: 2,
      bufA: [...REAL_MRP_BASELINE.gzipMagic],
      bufB: [...REAL_MRP_BASELINE.gzipMagic],
      ret: 0,
      equalPath: true,
    });
    expect(r.execution.gzipPathEntered).toBe(true);
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
      expect(e).toMatchObject({ message: ARM_INSN_BUDGET_THROWN });
    }
    expect(rt.unknownRequiredSlot).toBeNull();
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
      /* ARM insn budget */
    }
    const p = rt.ext!.owners.wrapper.p >>> 0;
    const erRw = rt.ext!.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0;
    expect(rt.ext!.mem.read32(erRw + REAL_MRP_BASELINE.getTimeErOff) >>> 0).toBe(0);
    expect(rt.unknownRequiredSlot).toBeNull();
  });
});
