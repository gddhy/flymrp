import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GuestMemory } from "../../src/hot/memory.ts";
import {
  MEMCPY3,
  memcpy2Forward,
  rangesOverlap,
  runMemcpy3Forensics,
} from "../../src/real/memcpy3.ts";
import { FILECHAIN } from "../../src/real/filechain.ts";
import { runProductionCode0Fault } from "../../src/real/code0chain.ts";
import { ARM_INSN_BUDGET_THROWN } from "../../src/real/startup.ts";

const REAL_APP = resolve(import.meta.dirname, "../fixtures/real/app.mrp");

describe("5-C.10L table[3] memcpy2 ABI forensics", () => {
  it("LIVE first table[3] is memcpy2(dst,src,4); 3/10 now execute; stop is table[1]", () => {
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const r = runMemcpy3Forensics(bytes);

    expect(r.productionThrown).toBe(ARM_INSN_BUDGET_THROWN);
    expect(r.probeThrown).toBe(ARM_INSN_BUDGET_THROWN);
    expect(r.owner).toBe("gssjxz.mrp");
    expect(r.handler40).toBe(true);
    expect(r.handler44).toBe(true);
    expect(r.handler45).toBe(true);
    expect(r.handler41).toBe(true);
    expect(r.handler3).toBe(true);
    expect(r.handler10).toBe(true);
    expect(r.handler1).toBe(true);

    expect(r.cpu.pc).toBe(MEMCPY3.stub);
    expect(r.cpu.lr).toBe(MEMCPY3.lr);
    expect(r.cpu.sp).toBe(MEMCPY3.sp);
    expect(r.cpu.cpsr).toBe(MEMCPY3.cpsr);
    expect(r.cpu.tBit).toBe(0);
    expect(r.cpu.insnCount).toBe(MEMCPY3.insnCount);
    expect(r.cpu.r[0]).toBe(MEMCPY3.dst);
    expect(r.cpu.r[1]).toBe(MEMCPY3.src);
    expect(r.cpu.r[2]).toBe(MEMCPY3.count);
    expect(r.cpu.r[3]).toBe(MEMCPY3.stub);
    expect(r.cpu.r[4]).toBe(MEMCPY3.r4);
    expect(r.cpu.r[5]).toBe(MEMCPY3.r5);
    expect(r.cpu.r[6]).toBe(MEMCPY3.sprintfBuf);
    expect(r.cpu.r[7]).toBe(MEMCPY3.tempName);
    expect(r.cpu.r[8]).toBe(MEMCPY3.r8);
    expect(r.cpu.r9).toBe(MEMCPY3.erRw);
    expect(r.p).toBe(MEMCPY3.p);
    expect(r.helper).toBe(MEMCPY3.helper);
    expect(r.erRw).toBe(MEMCPY3.erRw);

    expect(r.srcU32).toBe(MEMCPY3.srcLe);
    expect(r.srcBytes.slice(0, 4)).toEqual([9, 0, 0, 0]);
    expect(r.srcBytes.slice(4, 13)).toEqual([...MEMCPY3.firstName].map((ch) => ch.charCodeAt(0)).concat(0));
    expect(r.archiveOff).toBe(MEMCPY3.archiveOff);
    expect(r.archiveBytes.slice(0, 4)).toEqual([9, 0, 0, 0]);
    expect(r.indexHeaderGuest).toBe(MEMCPY3.indexHeaderGuest);
    expect(r.indexHeaderSize).toBe(MEMCPY3.indexHeaderSize);
    expect(r.indexUser).toBe(MEMCPY3.indexUser);
    expect(r.indexUser - r.indexHeaderGuest).toBe(4);

    expect(r.overlap).toBe(false);
    expect(
      rangesOverlap(MEMCPY3.dst, MEMCPY3.dst + MEMCPY3.count, MEMCPY3.src, MEMCPY3.src + MEMCPY3.count),
    ).toBe(false);
    expect(r.returnConsumer).toBe("none");

    const afterHw = r.after.map((l) => l.pc);
    expect(afterHw[0]).toBe(MEMCPY3.liveRet);
    expect(r.after.some((l) => l.pc === MEMCPY3.liveRet && l.op !== undefined)).toBe(true);
    expect(r.after.find((l) => l.pc === MEMCPY3.liveRet)?.text).toContain("LDR");
    expect(r.after.find((l) => l.pc === MEMCPY3.nameMemcpyBlx)).toBeTruthy();
    expect(r.after.find((l) => l.pc === MEMCPY3.strcmpBlx)).toBeTruthy();
    expect(r.after.find((l) => l.pc === MEMCPY3.filePosBlx)).toBeTruthy();
    expect(r.after.find((l) => l.pc === MEMCPY3.fileLenBlx)).toBeTruthy();

    expect(r.mallocWrap[0]?.pc).toBe(MEMCPY3.mallocWrap);
    expect(r.freeWrap[0]?.pc).toBe(MEMCPY3.freeWrap);

    const live = r.table3Calls.find((c) => c.blx === MEMCPY3.liveBlx);
    expect(live?.kind).toBe("LIVE startup required");
    expect(live?.inReadFile).toBe(true);
    expect(r.table3Calls.filter((c) => c.inReadFile).length).toBe(9);
    expect(r.table3Calls.length).toBe(13);
    expect(r.table10Calls.length).toBe(2);
    expect(r.table3Calls.every((c) => c.blx !== MEMCPY3.liveBlx || c.kind === "LIVE startup required")).toBe(true);
    expect(r.table10Calls.some((c) => c.blx === MEMCPY3.strcmpBlx && c.inReadFile)).toBe(true);
    expect(r.nextSlots).toEqual([3, 10, 1]);
    expect(r.decision).toBe("SPLIT");
    expect(FILECHAIN.fn).toBe(0x01ea8cdc);
  });

  it("5 production runs stay deterministic at table[1]", () => {
    const bytes = new Uint8Array(readFileSync(REAL_APP));
    const runs = Array.from({ length: 5 }, () => runProductionCode0Fault(bytes));
    expect(new Set(runs)).toEqual(new Set([ARM_INSN_BUDGET_THROWN]));
    const snaps = Array.from({ length: 5 }, () => runMemcpy3Forensics(bytes));
    const key = (r: (typeof snaps)[0]) =>
      [r.cpu.pc, r.cpu.lr, r.cpu.sp, r.cpu.r[0], r.cpu.r[1], r.cpu.r[2], r.cpu.insnCount, r.p, r.erRw].join(",");
    expect(new Set(snaps.map(key)).size).toBe(1);
  });

  it("TypedArray.set / GuestMemory.load(slice) are not memcpy2 on overlap", () => {
    const host = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const forward = new Uint8Array(host);
    memcpy2Forward(forward.subarray(1), forward.subarray(0), 4);
    const viaSet = new Uint8Array(host);
    viaSet.subarray(1).set(viaSet.subarray(0, 4));
    expect(forward).toEqual(new Uint8Array([1, 1, 1, 1, 1, 6, 7, 8]));
    expect(viaSet).toEqual(new Uint8Array([1, 1, 2, 3, 4, 6, 7, 8]));
    expect(viaSet).not.toEqual(forward);

    const mem = new GuestMemory(0x0001_0000, 0x1000);
    mem.load(0x0001_0000, [1, 2, 3, 4, 5, 6, 7, 8]);
    mem.load(0x0001_0001, mem.slice(0x0001_0000, 4));
    expect([...mem.slice(0x0001_0000, 8)]).toEqual([1, 1, 2, 3, 4, 6, 7, 8]);
  });

});
