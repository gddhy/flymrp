/**
 * Stage 5-C.10Q — forensic ARM instruction-budget sweep for real guest inflate.
 * Does not register new ABI. Does not call host gzip/inflate on the production path.
 * Host gunzip is verification-only when comparing guest output.
 * Stage 5-D is not started.
 */
import { gunzipSync } from "node:zlib";
import { ExtStopKind } from "../abi/fault.ts";
import { EXT_CODE_ADDR, EXT_TABLE_ADDR, EXT_TABLE_COUNT, tableSlotIndex } from "../abi/layout.ts";
import { mapExtImage, parseExtImage } from "../abi/loader.ts";
import { DEFAULT_INSN_BUDGET } from "../abi/runtime.ts";
import { unknownTableSlot } from "../err/errors.ts";
import { ARMCPU } from "../hot/cpu.ts";
import { decodeThumb16, isThumb32Prefix } from "../hot/decode-thumb16.ts";
import { decodeThumb32 } from "../hot/decode-thumb32.ts";
import { GuestMemory } from "../hot/memory.ts";
import { AUX_SHIFT_REG, OP_NAMES, Op, unpackW0 } from "../hot/opcodes.ts";
import { TAG_FUNCTION } from "../lua/types.ts";
import { MRPArchive } from "../mrp/archive.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { stackPreview } from "../mythroad/probe.ts";
import { REAL_MRP_BASELINE } from "./startup.ts";

const PACK = new Uint32Array(3);

export const FORENSIC_INSN_BUDGETS = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000] as const;
export const FORENSIC_BUDGET_CEILING = 20_000_000;

export type ThumbLine = {
  pc: number;
  size: number;
  op: number;
  target: number | null;
  text: string;
};

export type NativeRec = {
  name: string;
  args: unknown[];
  nresults: number | null;
  ok: boolean;
  error?: string;
};

export type Table0Alloc = { size: number; addr: number; afterTable9: boolean };
export type Table3Copy = { dst: number; src: number; n: number; lr: number };

export type OpcodeStats = {
  decodedBlocks: number;
  decodedInsns: number;
  arm: number;
  thumb16: number;
  thumb32: number;
  alu: number;
  mul: number;
  loadStore: number;
  ldmStm: number;
  branch: number;
  shift: number;
  undef: number;
  names: Record<string, number>;
};

export type CpuHealth = {
  tBit: number;
  spMin: number;
  spMax: number;
  spDelta: number;
  uniqueLr: number[];
  uniqueR9: number[];
  pingPongPairs: number;
  codeWrites: number;
  codeWriteAddrs: number[];
  tableStubAsCode: number;
  unsupported: boolean;
  memoryFault: boolean;
};

export type InflateProgress = {
  gzipIn: number | null;
  gzipInLen: number;
  gzipMagic: number[];
  outBuf: number | null;
  outLen: number | null;
  dataOff: number;
  gzipIsize: number | null;
  outCursor: number | null;
  lastTable3Dst: number | null;
  lastTable3Src: number | null;
  lastTable3N: number | null;
  table3InWindow: number;
  table3MaxDst: number | null;
  table3MinDst: number | null;
  prefixMatch: number | null;
  referenceLen: number | null;
  prefixEqual: boolean | null;
  uniqueBlockEntries: number;
  decodedBlocks: number;
  regsInInput: number[];
  regsInOutput: number[];
  stackCodeAddrs: number[];
};

export type InflateBudgetReport = {
  budget: number;
  productionDefaultBudget: number;
  insnCount: number;
  wallMs: number;
  mips: number;
  bridgeMs: number;
  bridgeCalls: number;
  stopKind: string;
  thrown: string;
  thrownType: string;
  unknownSlot: number | null;
  cpu: {
    pc: number;
    cpsr: number;
    sp: number;
    lr: number;
    r9: number;
    tBit: number;
    r: number[];
    insnCount: number;
  } | null;
  hits: { total: number; table0: number; table1: number; table3: number; table9: number; uniqueSlots: number[] };
  allocs: { count: number; live: number; bump: number };
  progress: InflateProgress;
  opcodes: OpcodeStats | null;
  health: CpuHealth;
  armExt0: { returned: boolean; kind: string | null; r0: number | null; insnCount: number | null };
  lua: { resumed: boolean; insn: number; natives: NativeRec[] };
  strCom: { code: unknown; extra: unknown; ok: boolean; error?: string }[];
  fnStart: number | null;
  stopDisasm: ThumbLine[];
  memcpyCallsite: ThumbLine[];
  inflateConfirmed: boolean;
  outputVerified: boolean | null;
  outputLen: number | null;
};

export type InflateBudgetSweep = {
  fixture: string;
  payloadLen: number;
  gzipIsize: number | null;
  runs: InflateBudgetReport[];
  looping: boolean;
  firstCompletion: InflateBudgetReport | null;
};

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errType(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

function snapExtCpu(e: { cpu: ARMCPU; mem: GuestMemory }): InflateBudgetReport["cpu"] {
  const r = [...e.cpu.r].map((v) => v >>> 0);
  return {
    pc: r[15]!,
    cpsr: e.cpu.cpsr >>> 0,
    sp: r[13]!,
    lr: r[14]!,
    r9: r[9]!,
    tBit: e.cpu.t & 1,
    r,
    insnCount: e.cpu.insnCount | 0,
  };
}

function readGzipIsize(payload: Uint8Array): number | null {
  if (payload.length < 8) return null;
  const n = payload.length;
  return (
    payload[n - 4]! |
    (payload[n - 3]! << 8) |
    (payload[n - 2]! << 16) |
    (payload[n - 1]! << 24)
  ) >>> 0;
}

export function fmtThumb(pc: number, mem: { read16(addr: number): number }): ThumbLine {
  const hw1 = mem.read16(pc) & 0xffff;
  if (isThumb32Prefix(hw1)) {
    const hw2 = mem.read16((pc + 2) >>> 0) & 0xffff;
    decodeThumb32(hw1, hw2, PACK, 0);
    const u = unpackW0(PACK[0]!);
    const imm = PACK[1]! | 0;
    let target: number | null = null;
    let extra = "";
    if (u.op === Op.BL || u.op === Op.B || u.op === Op.BLX) {
      target = (pc + 4 + imm) >>> 0;
      extra = ` target=${hx(target)}`;
    }
    return {
      pc,
      size: 4,
      op: u.op,
      target,
      text: `${hx(pc)}  ${hw1.toString(16).padStart(4, "0")} ${hw2.toString(16).padStart(4, "0")}  ${OP_NAMES[u.op] ?? u.op} rd=${u.rd} rn=${u.rn} rm=${u.rm} imm=${hx(PACK[1]!)}${extra}`,
    };
  }
  decodeThumb16(hw1, PACK, 0);
  const u = unpackW0(PACK[0]!);
  let extra = "";
  if (u.op === Op.BLX || u.op === Op.BX) extra = ` rm=r${u.rm}`;
  if (u.op === Op.B) extra = ` target=${hx((pc + 4 + (PACK[1]! | 0)) >>> 0)}`;
  return {
    pc,
    size: 2,
    op: u.op,
    target: u.op === Op.B ? ((pc + 4 + (PACK[1]! | 0)) >>> 0) : null,
    text: `${hx(pc)}  ${hw1.toString(16).padStart(4, "0")}  ${OP_NAMES[u.op] ?? u.op} rd=${u.rd} rn=${u.rn} rm=${u.rm} imm=${hx(PACK[1]!)}${extra}`,
  };
}

export function disasmThumbRange(mem: { read16(addr: number): number }, start: number, end: number): ThumbLine[] {
  const out: ThumbLine[] = [];
  let p = start >>> 0;
  while (p < end) {
    const d = fmtThumb(p, mem);
    out.push(d);
    p = (p + d.size) >>> 0;
  }
  return out;
}

export function findThumbFnStart(mem: { read16(addr: number): number }, pc: number, maxBack = 0x400): number {
  let p = pc & ~1;
  const lo = Math.max(EXT_CODE_ADDR, p - maxBack);
  while (p > lo) {
    p = (p - 2) >>> 0;
    const hw = mem.read16(p) & 0xffff;
    if ((hw & 0xff00) === 0xb500) return p;
    if (hw === 0xe92d) return p;
  }
  return pc & ~1;
}

function classifyPacked(stats: OpcodeStats, w0: number, _w1: number, w2: number, thumb: number): void {
  const u = unpackW0(w0);
  const size = (w2 >>> 8) & 0xff;
  stats.decodedInsns++;
  if (!thumb) stats.arm++;
  else if (size === 4) stats.thumb32++;
  else stats.thumb16++;
  const name = OP_NAMES[u.op] ?? `op${u.op}`;
  stats.names[name] = (stats.names[name] ?? 0) + 1;
  if (u.op === Op.UNDEF) stats.undef++;
  if (u.op >= Op.AND && u.op <= Op.MVN) stats.alu++;
  if (u.op >= Op.MUL && u.op <= Op.SMLAL) stats.mul++;
  if (u.op >= Op.LDR && u.op <= Op.STRH) stats.loadStore++;
  if (u.op === Op.LDRSB || u.op === Op.LDRSH) stats.loadStore++;
  if (u.op === Op.LDM || u.op === Op.STM) stats.ldmStm++;
  if (u.op === Op.B || u.op === Op.BL || u.op === Op.BX || u.op === Op.BLX || u.op === Op.CBZ || u.op === Op.CBNZ) {
    stats.branch++;
  }
  if ((u.aux & AUX_SHIFT_REG) !== 0 || u.shiftType !== 0) stats.shift++;
}

function opcodeStatsFromCache(cpu: ARMCPU): OpcodeStats {
  const stats: OpcodeStats = {
    decodedBlocks: 0,
    decodedInsns: 0,
    arm: 0,
    thumb16: 0,
    thumb32: 0,
    alu: 0,
    mul: 0,
    loadStore: 0,
    ldmStm: 0,
    branch: 0,
    shift: 0,
    undef: 0,
    names: {},
  };
  const pool = cpu.cache?.pool ?? [];
  for (const b of pool) {
    if (!b) continue;
    stats.decodedBlocks++;
    for (let i = 0; i < b.count; i++) {
      const o = i * 3;
      classifyPacked(stats, b.packed[o]!, b.packed[o + 1]!, b.packed[o + 2]!, b.thumb);
    }
  }
  return stats;
}

function wrapNatives(rt: MythroadRuntime, log: NativeRec[]): void {
  const L = rt.lua.L;
  const wrap = (slot: { tag: number; num: number }, name: string) => {
    if (slot.tag !== TAG_FUNCTION) return;
    const cl = L.closures[slot.num];
    if (!cl || !cl.isC) return;
    const orig = cl.fn;
    cl.fn = (state) => {
      const preview = stackPreview(state, 8);
      try {
        const n = orig(state);
        log.push({ name, args: preview.arguments, nresults: n, ok: true });
        return n;
      } catch (e) {
        log.push({ name, args: preview.arguments, nresults: null, ok: false, error: errText(e) });
        throw e;
      }
    };
  };
  for (const name of ["_strCom", "_com", "GetSysInfo", "TestCom1", "TestCom"]) {
    wrap(L.getGlobal(name), name);
  }
}

function inRange(addr: number, lo: number, hi: number): boolean {
  const a = addr >>> 0;
  return a >= lo && a < hi;
}

function prefixMatchLen(mem: GuestMemory, addr: number, ref: Uint8Array, max: number): number {
  const n = Math.min(max, ref.length);
  let i = 0;
  try {
    for (; i < n; i++) {
      if ((mem.read8((addr + i) >>> 0) & 0xff) !== ref[i]!) break;
    }
  } catch {
    return i;
  }
  return i;
}

function stackCodeAddrs(mem: GuestMemory, sp: number, words = 16): number[] {
  const out: number[] = [];
  for (let i = 0; i < words; i++) {
    try {
      const w = mem.read32((sp + i * 4) >>> 0) >>> 0;
      if (w >= EXT_CODE_ADDR && w < EXT_CODE_ADDR + 0x40000) out.push(w);
    } catch {
      break;
    }
  }
  return out;
}

export function disasmBudgetStopStatic(mrp: Uint8Array): {
  fnStart: number;
  stop: number;
  memcpyLr: number;
  around: ThumbLine[];
  fnHead: ThumbLine[];
  memcpySite: ThumbLine[];
} {
  const bytes = MRPArchive.parse(mrp).readFile("cfunction.ext");
  if (!bytes) throw new Error("missing cfunction.ext");
  const mem = new GuestMemory(0x0001_0000, 0x0010_0000);
  mem.map(EXT_CODE_ADDR, (bytes.length + 0x1000) & ~0xfff);
  mapExtImage(mem, parseExtImage(bytes), EXT_CODE_ADDR);
  const stop = REAL_MRP_BASELINE.budgetStopPc;
  const fnStart = findThumbFnStart(mem, stop);
  const memcpyLr = REAL_MRP_BASELINE.budgetStopLr;
  const site = (memcpyLr & ~1) - 4;
  return {
    fnStart,
    stop,
    memcpyLr,
    around: disasmThumbRange(mem, (stop - 0x20) >>> 0, (stop + 0x40) >>> 0),
    fnHead: disasmThumbRange(mem, fnStart, (fnStart + 0x20) >>> 0),
    memcpySite: disasmThumbRange(mem, site >>> 0, ((memcpyLr & ~1) + 0x10) >>> 0),
  };
}

export function runInflateBudget(mrp: Uint8Array, opts: { budget?: number } = {}): InflateBudgetReport {
  const budget = opts.budget ?? DEFAULT_INSN_BUDGET;
  const arc = MRPArchive.parse(mrp);
  const ent = arc.entries.find((e) => e.name === "res_lang0.rc");
  const rawGzip = ent
    ? new Uint8Array(arc.data.subarray(ent.offset, ent.offset + ent.storedLength))
    : new Uint8Array();
  const isize = readGzipIsize(rawGzip);
  let reference: Uint8Array | null = null;
  if (rawGzip.length >= 2 && rawGzip[0] === 0x1f && rawGzip[1] === 0x8b) {
    try {
      reference = new Uint8Array(gunzipSync(rawGzip));
    } catch {
      reference = null;
    }
  }

  const natives: NativeRec[] = [];
  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });
  wrapNatives(rt, natives);

  const slotCounts = new Map<number, number>();
  const table0: Table0Alloc[] = [];
  let table9Seen = 0;
  let gzipIn: number | null = null;
  let gzipInLen = rawGzip.length;
  let outBuf: number | null = null;
  let outLen: number | null = null;
  let lastCopy: Table3Copy | null = null;
  let table3InWindow = 0;
  let table3MaxDst: number | null = null;
  let table3MinDst: number | null = null;
  const blockEntries = new Set<number>();
  const lrs = new Set<number>();
  const r9s = new Set<number>();
  let spMin = 0xffffffff;
  let spMax = 0;
  let pingPong = 0;
  let prevEntry = 0;
  let prevPrevEntry = 0;
  let inflatePhase = false;
  let codeWrites = 0;
  const codeWriteAddrs: number[] = [];
  let tableStubAsCode = 0;
  let bridgeMs = 0;
  let cpuSnap: InflateBudgetReport["cpu"] = null;
  let lastTableCpu: InflateBudgetReport["cpu"] = null;
  const extCalls: { code: number; ok: boolean; kind: string | null; r0: number | null; insnCount: number | null; error?: string }[] = [];

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    if (ext) ext.insnBudget = budget;
    origBind(ext);
    const e = rt.ext;
    if (!e) return;
    e.insnBudget = budget;

    const prevWrite = e.mem.onWrite;
    e.mem.onWrite = (addr, size) => {
      const a = addr >>> 0;
      if (a >= e.codeBase && a < (e.codeBase + e.codeLen) >>> 0) {
        codeWrites++;
        if (codeWriteAddrs.length < 8) codeWriteAddrs.push(a);
      }
      prevWrite?.(addr, size);
    };

    const prevFetch = e.cpu.onBeforeFetch;
    e.cpu.onBeforeFetch = (c) => {
      const pc = c.r[15] >>> 0;
      if (pc < EXT_TABLE_COUNT * 4 || (pc >= EXT_TABLE_ADDR && pc < EXT_TABLE_ADDR + EXT_TABLE_COUNT * 4)) {
        return prevFetch ? prevFetch(c) : false;
      }
      if (inflatePhase) {
        blockEntries.add(pc);
        lrs.add(c.r[14] >>> 0);
        r9s.add(c.r[9] >>> 0);
        const sp = c.r[13] >>> 0;
        if (sp < spMin) spMin = sp;
        if (sp > spMax) spMax = sp;
        if (pc === prevPrevEntry && pc !== prevEntry) pingPong++;
        prevPrevEntry = prevEntry;
        prevEntry = pc;
      }
      return prevFetch ? prevFetch(c) : false;
    };

    const origRun = e.runGuest.bind(e);
    e.runGuest = (start, regs) => {
      const out = origRun(start, regs);
      if (out.kind !== ExtStopKind.Return && !cpuSnap) cpuSnap = snapExtCpu(e);
      return out;
    };

    const origCall = e.arm_ext_call.bind(e);
    e.arm_ext_call = (code, input, inputAddr, inputLen) => {
      try {
        const out = origCall(code, input, inputAddr, inputLen);
        if (out.kind !== ExtStopKind.Return && !cpuSnap) cpuSnap = snapExtCpu(e);
        extCalls.push({
          code,
          ok: out.kind === ExtStopKind.Return,
          kind: out.kind,
          r0: out.r0 | 0,
          insnCount: out.insnCount | 0,
        });
        return out;
      } catch (err) {
        extCalls.push({
          code,
          ok: false,
          kind: null,
          r0: null,
          insnCount: e.cpu.insnCount | 0,
          error: errText(err),
        });
        throw err;
      }
    };

    const origD = e.table.dispatch.bind(e.table);
    e.table.dispatch = (c, mem, pc) => {
      const n = tableSlotIndex(pc);
      lastTableCpu = snapExtCpu(e);
      slotCounts.set(n, (slotCounts.get(n) ?? 0) + 1);
      const r0 = c.r[0] >>> 0;
      const r1 = c.r[1] >>> 0;
      const r2 = c.r[2] >>> 0;
      const lr = c.r[14] >>> 0;
      const t0 = performance.now();
      origD(c, mem, pc);
      bridgeMs += performance.now() - t0;
      if (n === 9) table9Seen++;
      if (n === 44 && rawGzip.length && r2 === rawGzip.length) {
        gzipIn = r1 >>> 0;
        gzipInLen = r2 >>> 0;
      }
      if (n === 0) {
        const after = table9Seen > 0;
        table0.push({ size: r0, addr: c.r[0] >>> 0, afterTable9: after });
        if (after && outBuf === null && (r0 === 30196 || (isize !== null && r0 === isize))) {
          outBuf = c.r[0] >>> 0;
          outLen = r0;
        }
        if (after && outBuf === null && isize !== null && r0 === isize + 4) {
          outBuf = c.r[0] >>> 0;
          outLen = r0;
        }
      }
      if (n === 3 && table9Seen > 0) {
        inflatePhase = true;
        lastCopy = { dst: r0, src: r1, n: r2, lr };
        if (outBuf !== null && outLen !== null && inRange(r0, outBuf, outBuf + outLen)) {
          table3InWindow++;
          const end = (r0 + r2) >>> 0;
          if (table3MaxDst === null || end > table3MaxDst) table3MaxDst = end;
          if (table3MinDst === null || r0 < table3MinDst) table3MinDst = r0;
        }
      }
    };
  };

  const t0 = performance.now();
  let thrown = "";
  let thrownType = "";
  let unknownSlot: number | null = null;
  let chunkReturned = false;
  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
    chunkReturned = true;
  } catch (e) {
    thrown = errText(e);
    thrownType = errType(e);
    unknownSlot = unknownTableSlot(e) ?? rt.unknownRequiredSlot;
  }
  const wallMs = performance.now() - t0;

  const e = rt.ext;
  const cpu = cpuSnap ?? lastTableCpu ?? (e ? snapExtCpu(e) : null);

  if (gzipIn === null && REAL_MRP_BASELINE) {
    const hint = 0x00206e6c;
    if (e) {
      try {
        if (e.mem.read8(hint) === 0x1f && e.mem.read8(hint + 1) === 0x8b) {
          gzipIn = hint;
          gzipInLen = rawGzip.length;
        }
      } catch {
        /* keep null */
      }
    }
  }

  if (outBuf === null) {
    const guessed = table0.find((a) => a.afterTable9 && (a.size === 30196 || (isize !== null && a.size === isize)));
    if (guessed) {
      outBuf = guessed.addr;
      outLen = guessed.size;
    }
  }

  const regsInInput: number[] = [];
  const regsInOutput: number[] = [];
  if (cpu && gzipIn !== null) {
    for (const v of cpu.r) {
      if (inRange(v, gzipIn, gzipIn + gzipInLen)) regsInInput.push(v);
    }
  }
  if (cpu && outBuf !== null && outLen !== null) {
    for (const v of cpu.r) {
      if (inRange(v, outBuf, outBuf + outLen)) regsInOutput.push(v);
    }
  }

  let dataOff = 0;
  if (e && outBuf !== null && reference) {
    const head = e.mem.read32(outBuf) >>> 0;
    if (head === reference.length || (isize !== null && head === isize)) dataOff = 4;
  } else if (outLen !== null && isize !== null && outLen === isize + 4) {
    dataOff = 4;
  }

  let prefixMatch: number | null = null;
  let prefixEqual: boolean | null = null;
  if (e && outBuf !== null && reference) {
    prefixMatch = prefixMatchLen(e.mem, (outBuf + dataOff) >>> 0, reference, reference.length);
    prefixEqual = prefixMatch === reference.length;
  }

  const copy = lastCopy as Table3Copy | null;
  const fnStart = e && cpu ? findThumbFnStart(e.mem, cpu.pc) : null;
  const stopDisasm = e && cpu ? disasmThumbRange(e.mem, (cpu.pc - 0x18) >>> 0, (cpu.pc + 0x28) >>> 0) : [];
  const memcpyCallsite =
    e && copy
      ? disasmThumbRange(e.mem, ((copy.lr & ~1) - 6) >>> 0, ((copy.lr & ~1) + 0x0c) >>> 0)
      : [];

  const inflateConfirmed =
    table9Seen > 0 &&
    copy !== null &&
    copy.lr === REAL_MRP_BASELINE.budgetStopLr &&
    outBuf !== null &&
    outLen !== null &&
    inRange(copy.dst, outBuf, outBuf + outLen);

  const code0 = extCalls.find((c) => c.code === 0);
  const strCom = natives
    .filter((n) => n.name === "_strCom")
    .map((n) => ({
      code: Array.isArray(n.args) ? n.args[0] : undefined,
      extra: Array.isArray(n.args) ? n.args[2] : undefined,
      ok: n.ok,
      error: n.error,
    }));

  let outputVerified: boolean | null = null;
  let outputLen: number | null = null;
  if (chunkReturned && e && outBuf !== null && reference && prefixMatch === reference.length) {
    outputVerified = true;
    outputLen = reference.length;
  } else if (prefixEqual === true) {
    outputVerified = true;
    outputLen = reference?.length ?? null;
  }

  const hitsTotal = [...slotCounts.values()].reduce((a, b) => a + b, 0);
  const opcodes = e ? opcodeStatsFromCache(e.cpu) : null;
  const live = rt.mrTable?.liveAllocs().length ?? 0;

  return {
    budget,
    productionDefaultBudget: DEFAULT_INSN_BUDGET,
    insnCount: code0?.ok && code0.insnCount != null ? code0.insnCount : cpu?.insnCount ?? 0,
    wallMs,
    mips: wallMs > 0 && cpu ? cpu.insnCount / wallMs / 1000 : 0,
    bridgeMs,
    bridgeCalls: e?.bridgeCalls ?? 0,
    stopKind: code0?.kind ?? (thrown.includes("abi-fault") ? "abi-fault" : thrownType || (chunkReturned ? "return" : "")),
    thrown,
    thrownType,
    unknownSlot,
    cpu,
    hits: {
      total: hitsTotal,
      table0: slotCounts.get(0) ?? 0,
      table1: slotCounts.get(1) ?? 0,
      table3: slotCounts.get(3) ?? 0,
      table9: slotCounts.get(9) ?? 0,
      uniqueSlots: [...slotCounts.keys()].sort((a, b) => a - b),
    },
    allocs: {
      count: rt.mrAllocs.length,
      live,
      bump: e?.heapTop ?? 0,
    },
    progress: {
      gzipIn,
      gzipInLen,
      gzipMagic: gzipIn && e ? [e.mem.read8(gzipIn), e.mem.read8(gzipIn + 1)] : [...rawGzip.subarray(0, 2)],
      outBuf,
      outLen,
      dataOff,
      gzipIsize: isize,
      outCursor: table3MaxDst !== null && outBuf !== null ? table3MaxDst - outBuf : null,
      lastTable3Dst: copy?.dst ?? null,
      lastTable3Src: copy?.src ?? null,
      lastTable3N: copy?.n ?? null,
      table3InWindow,
      table3MaxDst,
      table3MinDst,
      prefixMatch,
      referenceLen: reference?.length ?? null,
      prefixEqual,
      uniqueBlockEntries: blockEntries.size,
      decodedBlocks: opcodes?.decodedBlocks ?? 0,
      regsInInput,
      regsInOutput,
      stackCodeAddrs: e && cpu ? stackCodeAddrs(e.mem, cpu.sp) : [],
    },
    opcodes,
    health: {
      tBit: cpu?.tBit ?? 0,
      spMin: spMin === 0xffffffff ? cpu?.sp ?? 0 : spMin,
      spMax: spMax || (cpu?.sp ?? 0),
      spDelta: (spMax || 0) - (spMin === 0xffffffff ? 0 : spMin),
      uniqueLr: [...lrs].slice(0, 12),
      uniqueR9: [...r9s],
      pingPongPairs: pingPong,
      codeWrites,
      codeWriteAddrs,
      tableStubAsCode,
      unsupported: thrownType === "UnsupportedInsn" || thrown.includes("Unsupported"),
      memoryFault: thrownType === "MemoryFault" || thrown.includes("GuestMemory"),
    },
    armExt0: {
      returned: code0?.ok === true,
      kind: code0?.kind ?? null,
      r0: code0?.r0 ?? null,
      insnCount: code0?.insnCount ?? null,
    },
    lua: {
      resumed: chunkReturned,
      insn: rt.lua.L.insnCount | 0,
      natives,
    },
    strCom,
    fnStart,
    stopDisasm,
    memcpyCallsite,
    inflateConfirmed,
    outputVerified,
    outputLen,
  };
}

export function runInflateBudgetSweep(
  mrp: Uint8Array,
  budgets: readonly number[] = FORENSIC_INSN_BUDGETS,
): InflateBudgetSweep {
  const arc = MRPArchive.parse(mrp);
  const ent = arc.entries.find((e) => e.name === "res_lang0.rc");
  const raw = ent ? arc.data.subarray(ent.offset, ent.offset + ent.storedLength) : new Uint8Array();
  const runs: InflateBudgetReport[] = [];
  for (const b of budgets) {
    if (b > FORENSIC_BUDGET_CEILING) break;
    runs.push(runInflateBudget(mrp, { budget: b }));
  }
  const cursors = runs.map((r) => r.progress.prefixMatch ?? r.progress.outCursor ?? 0);
  let looping = runs.length >= 2;
  for (let i = 1; i < cursors.length; i++) {
    if (cursors[i]! > cursors[i - 1]!) looping = false;
  }
  if (runs.some((r) => r.armExt0.returned || r.lua.resumed || r.unknownSlot !== null)) looping = false;
  return {
    fixture: "test/fixtures/real/app.mrp",
    payloadLen: raw.length,
    gzipIsize: readGzipIsize(raw),
    runs,
    looping,
    firstCompletion: runs.find((r) => r.armExt0.returned || r.lua.resumed || (r.unknownSlot !== null && !r.thrown.includes("abi-fault"))) ?? null,
  };
}

/** Live runtime stopped at the given ARM watchdog. Forensic continuation / Unicorn window. */
export function runToArmBudget(mrp: Uint8Array, budget = DEFAULT_INSN_BUDGET): {
  rt: MythroadRuntime;
  thrown: string;
  cpu: InflateBudgetReport["cpu"];
} {
  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });
  let cpu: InflateBudgetReport["cpu"] = null;
  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    if (ext) ext.insnBudget = budget;
    origBind(ext);
    const e = rt.ext;
    if (!e) return;
    e.insnBudget = budget;
    const origRun = e.runGuest.bind(e);
    e.runGuest = (start, regs) => {
      const out = origRun(start, regs);
      if (out.kind !== ExtStopKind.Return) cpu = snapExtCpu(e);
      return out;
    };
  };
  let thrown = "";
  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
  } catch (e) {
    thrown = errText(e);
  }
  const snap = cpu as NonNullable<InflateBudgetReport["cpu"]> | null;
  if (snap && rt.ext) {
    rt.ext.cpu.loadRegs(snap.r);
    rt.ext.cpu.cpsr = snap.cpsr;
    rt.ext.cpu.r[15] = snap.pc;
    rt.ext.cpu.t = snap.tBit;
  }
  return { rt, thrown, cpu: snap };
}

export function renderInflateBudgetMarkdown(sweep: InflateBudgetSweep, staticDisasm?: ReturnType<typeof disasmBudgetStopStatic>): string {
  const lines: string[] = [
    "# Stage 5-C.10Q：ARM_INSN_BUDGET Forensics + Real Guest Inflate",
    "",
    "状态：取证完成。**未实现** gzip / inflate host ABI / 新 slot。**Stage 5-D NOT STARTED。**",
    "",
    "```text",
    `payload res_lang0.rc  len=${sweep.payloadLen}  gzipIsize=${sweep.gzipIsize ?? "null"}`,
    `looping=${sweep.looping}`,
    "```",
    "",
    "## Budget sweep",
    "",
  ];
  for (const r of sweep.runs) {
    const c = r.cpu;
    lines.push(
      "```text",
      `budget=${r.budget}  insn=${r.insnCount}  kind=${r.stopKind}  thrown=${r.thrown || "(none)"}`,
      c
        ? `PC=${hx(c.pc)}  CPSR=${hx(c.cpsr)}  SP=${hx(c.sp)}  LR=${hx(c.lr)}  R9=${hx(c.r9)}  T=${c.tBit}`
        : "cpu=null",
      `hits=${r.hits.total}  t0=${r.hits.table0}  t1=${r.hits.table1}  t3=${r.hits.table3}  t9=${r.hits.table9}`,
      `allocs=${r.allocs.count}  live=${r.allocs.live}  bump=${hx(r.allocs.bump)}`,
      `outBuf=${r.progress.outBuf !== null ? hx(r.progress.outBuf) : "null"}  outLen=${r.progress.outLen}  cursor=${r.progress.outCursor}  prefix=${r.progress.prefixMatch}/${r.progress.referenceLen}`,
      `arm_ext_call(0) returned=${r.armExt0.returned} kind=${r.armExt0.kind} r0=${r.armExt0.r0}`,
      `Lua resumed=${r.lua.resumed} insn=${r.lua.insn}`,
      `wallMs=${r.wallMs.toFixed(1)}  mips=${r.mips.toFixed(2)}  bridgeMs=${r.bridgeMs.toFixed(1)}  bridgeCalls=${r.bridgeCalls}`,
      "```",
      "",
    );
  }
  if (staticDisasm) {
    lines.push("## PC 0x01ea1ee8", "", "```text", `fnStart=${hx(staticDisasm.fnStart)}`, ...staticDisasm.fnHead.map((l) => l.text), "...", ...staticDisasm.around.map((l) => l.text), "... memcpy site ...", ...staticDisasm.memcpySite.map((l) => l.text), "```", "");
  }
  return lines.join("\n");
}
