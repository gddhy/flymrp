/**
 * Forensic Unicorn window against a real 1M budget-stop snapshot.
 * Not a production path. Does not change DEFAULT_INSN_BUDGET.
 */
import {
  EXT_CODE_ADDR,
  EXT_HEAP_ADDR,
  EXT_LOW_TABLE_SIZE,
  EXT_STACK_ADDR,
  EXT_STACK_SIZE,
  EXT_TABLE_ADDR,
  EXT_TABLE_COUNT,
} from "../../src/abi/layout.ts";
import { run } from "../../src/hot/interp.ts";
import { runToArmBudget } from "../../src/real/inflate-budget.ts";
import { hexBytes, unicornExt } from "./ext-oracle.ts";

export type WindowPoint = {
  count: number;
  tableStubs: number;
  uniCount: number;
  fly: { pc: number; cpsr: number; r: number[]; kind?: string };
  uni: { pc: number; cpsr: number; r: number[]; error: string | null } | null;
  mismatch: string[];
};

export type WindowDiffReport = {
  startPc: number;
  startCpsr: number;
  startRegs: number[];
  thrown: string;
  points: WindowPoint[];
};

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

function align4k(addr: number, size: number): { addr: number; size: number } {
  const a = addr & ~0xfff;
  const end = (addr + size + 0xfff) & ~0xfff;
  return { addr: a, size: end - a };
}

export async function runInflateWindowDiff(
  mrp: Uint8Array,
  windows: number[] = [100, 1000, 10_000],
): Promise<WindowDiffReport> {
  const { rt, thrown } = runToArmBudget(mrp, 1_000_000);
  const e = rt.ext;
  if (!e) throw new Error("no ext after budget stop");

  const regs = [...e.cpu.r].map((v) => v >>> 0);
  const cpsr = e.cpu.cpsr >>> 0;
  const thumb = e.cpu.t & 1;
  const pc = e.cpu.r[15] >>> 0;
  const heapTop = e.heapTop >>> 0;
  const codeLen = Math.max(e.codeLen, 0x40000);
  const heapSize = Math.max(0x20000, (heapTop - EXT_HEAP_ADDR + 0x20000) >>> 0);
  const stackLo = Math.max(EXT_STACK_ADDR, (e.cpu.r[13] - 0x2000) >>> 0);
  const stackHi = EXT_STACK_ADDR + EXT_STACK_SIZE;

  const maps = [
    align4k(0, EXT_LOW_TABLE_SIZE),
    align4k(EXT_TABLE_ADDR, 0x1000),
    align4k(EXT_HEAP_ADDR, heapSize),
    align4k(stackLo, stackHi - stackLo),
    align4k(EXT_CODE_ADDR, codeLen),
  ];
  const mem = [
    { addr: 0, hex: hexBytes(e.mem.slice(0, EXT_LOW_TABLE_SIZE)) },
    { addr: EXT_TABLE_ADDR, hex: hexBytes(e.mem.slice(EXT_TABLE_ADDR, 0x400)) },
    { addr: EXT_HEAP_ADDR, hex: hexBytes(e.mem.slice(EXT_HEAP_ADDR, heapSize)) },
    { addr: stackLo, hex: hexBytes(e.mem.slice(stackLo, stackHi - stackLo)) },
    { addr: EXT_CODE_ADDR, hex: hexBytes(e.mem.slice(EXT_CODE_ADDR, codeLen)) },
  ];
  const hooks = [
    { slot: 0, kind: "malloc" },
    { slot: 1, kind: "free" },
    { slot: 3, kind: "memcpy" },
    { slot: 9, kind: "memcmp" },
    { slot: 14, kind: "memset" },
  ];

  const points: WindowPoint[] = [];
  let executed = 0;
  let tableStubs = 0;
  const prevFetch = e.cpu.onBeforeFetch;
  e.cpu.onBeforeFetch = (c) => {
    const pc = c.r[15] >>> 0;
    const inTable =
      (pc < EXT_TABLE_COUNT * 4 && (pc & 3) === 0) ||
      (pc >= EXT_TABLE_ADDR && pc < EXT_TABLE_ADDR + EXT_TABLE_COUNT * 4);
    const consumed = prevFetch ? prevFetch(c) : false;
    if (inTable && consumed) tableStubs++;
    return consumed;
  };

  for (const w of [...windows].sort((a, b) => a - b)) {
    let kind: string | undefined;
    try {
      run(e.cpu, w - executed);
      kind = "ran";
    } catch (err) {
      kind = err instanceof Error ? err.message : String(err);
    }
    executed = w;
    const uniCount = w + tableStubs;
    const fly = {
      pc: e.cpu.r[15] >>> 0,
      cpsr: e.cpu.cpsr >>> 0,
      r: [...e.cpu.r].map((v) => v >>> 0),
      kind,
    };
    let uni: WindowPoint["uni"] = null;
    try {
      const out = await unicornExt({
        pc,
        thumb,
        regs,
        cpsr,
        count: uniCount,
        until: 0xffffffff,
        maps,
        mem,
        heap_top: heapTop,
        table_hooks: hooks,
      });
      uni = {
        pc: out.regs[15]! >>> 0,
        cpsr: out.cpsr >>> 0,
        r: out.regs.map((v) => v >>> 0),
        error: out.error,
      };
    } catch (err) {
      uni = { pc: 0, cpsr: 0, r: new Array(16).fill(0), error: err instanceof Error ? err.message : String(err) };
    }
    const mismatch: string[] = [];
    if (!uni) mismatch.push("no unicorn");
    else {
      if (uni.error) mismatch.push(`unicorn ${uni.error}`);
      if (fly.pc !== uni.pc) mismatch.push(`pc ${hx(fly.pc)} vs ${hx(uni.pc)}`);
      if (fly.cpsr !== uni.cpsr) mismatch.push(`cpsr ${hx(fly.cpsr)} vs ${hx(uni.cpsr)}`);
      for (let i = 0; i < 15; i++) {
        if (fly.r[i] !== uni.r[i]) mismatch.push(`r${i} ${hx(fly.r[i]!)} vs ${hx(uni.r[i]!)}`);
      }
    }
    points.push({ count: w, tableStubs, uniCount, fly, uni, mismatch });
  }

  return { startPc: pc, startCpsr: cpsr, startRegs: regs, thrown, points };
}
