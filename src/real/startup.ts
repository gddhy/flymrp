/**
 * Stage 5-C.10C — real MRP production startup.
 * table[130] case 7 + table[38] code 0x4c6 only (rxgj FULL). Does not implement [33].
 * No cbRet bypass. No backlight / Canvas / DOM side effects.
 */
import { AEX_P_ER_RW_LEN_OFF, AEX_P_ER_RW_OFF, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { LuaRuntimeError } from "../err/errors.ts";
import { LuaChunkReader } from "../lua/chunk.ts";
import { GET_OPCODE, GETARG_Bx, OP_CALL, OP_GETGLOBAL } from "../lua/opcodes.ts";
import { TAG_FUNCTION, TAG_STRING, TAG_TABLE, type ColdProto } from "../lua/types.ts";
import { MRPArchive } from "../mrp/archive.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { stackPreview, type TraceRecord } from "../mythroad/probe.ts";
import { inspectBytes } from "./inspect.ts";

export type ExecStatus = "REAL_EXECUTED" | "FORENSIC_BYPASSED" | "NOT_EXECUTED";
export type StagePass = "PASS" | "BLOCKED" | "NOT REACHED";

export const REAL_MRP_BASELINE = {
  slot130: 130,
  slot38: 38,
  slot33: 33,
  p: 0x00200100,
  helper: 0x01ea5e9d,
  erRw: 0x0020021c,
  rwLen: 19952,
  stub130: 0x00010208,
  stub38: 0x00010098,
  stub33: 0x00010084,
  case7: 7,
  case7Input1: 0x270f,
  erRw1cAfterCase7: 0x270d,
  platexCode: 0x4c6,
} as const;

export type CpuSnap = {
  pc: number;
  cpsr: number;
  r0: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
  r6: number;
  r7: number;
  r8: number;
  r9: number;
  sp: number;
  lr: number;
  tBit: number;
  insnCount: number;
  stack0: number;
  stack4: number;
  stack8: number;
  stack12: number;
};

export type NativeCallRec = {
  name: string;
  args: unknown[];
  nresults: number | null;
  ok: boolean;
  error?: string;
};

export type TableHit = {
  slot: number;
  callsite: number;
  arguments: [number, number, number, number];
  return: number | null;
  status: ExecStatus;
  note: string;
  pc: number;
  lr: number;
  r9: number;
  sp: number;
};

export type ExtCallRec = {
  code: number;
  ok: boolean;
  r0: number | null;
  kind: string | null;
  insnCount: number | null;
  error?: string;
};

export type ProgressRow = { stage: string; status: StagePass; note: string };

export type StartupFingerprint = {
  firstUnknownSlot: number | null;
  stopPc: number;
  p: number;
  helper: number;
  erRw: number;
  rwLen: number;
  armInsnCount: number;
  luaInsnCount: number;
  luaNativeSeq: string;
  tableSlots: number[];
  vfsReads: string[];
};

export type SlotStatusRow = {
  slot: number;
  status: ExecStatus;
  guestReached: boolean;
  handlerPresent: boolean;
  note: string;
};

export type RealMrpStartupReport = {
  mrp: {
    path: string;
    size: number;
    sha256: string;
    package: string;
    appname: string;
    resourceCount: number;
  };
  vfs: { reads: string[] };
  lua: {
    realStartMrLoaded: boolean;
    startMrBytes: number;
    opcodeCountMain: number;
    opcodeCountTotal: number;
    opcodeCallCount: number;
    getglobalNames: string[];
    luaInsnCount: number;
    nativeCalls: NativeCallRec[];
    strCom: { code: number; extra: number; ok: boolean; nresults: number | null }[];
    strCom801: {
      code: number;
      extra: number;
      returnedToLua: boolean;
      r0: number | null;
      nresults: number | null;
      error?: string;
    }[];
    chunkReturned: boolean;
    exception: { type: string; message: string; isLuaVmError: boolean } | null;
  };
  ext: {
    mrcLoaderLoad: boolean;
    mrcLoaderRet: number | null;
    cfunctionLoad: boolean;
    cfunctionRet: number | null;
    cfunctionBytes: number;
    p: number;
    helper: number;
    erRw: number;
    rwLen: number;
    erRwPlus1c: number;
    calls: ExtCallRec[];
  };
  execution: {
    armExtCallCode: number | null;
    cpu130: CpuSnap | null;
    cpu38: CpuSnap | null;
    cpu: CpuSnap | null;
    table38Return: number | null;
    table38ReturnConsumer: string;
  };
  mrTable: {
    hits: TableHit[];
    slots: SlotStatusRow[];
    handlers: { slot: number; present: boolean }[];
  };
  stop: {
    reason: string;
    pc: number | null;
    slot: number | null;
    owner: string;
  };
  progress: ProgressRow[];
  baseline: {
    deterministic: boolean;
    firstProductionBlocker: string;
    firstPost130Blocker: string;
  };
  forensicPrior: {
    table130: ExecStatus;
    table38: ExecStatus;
    table33: ExecStatus;
    note: string;
  };
  consistency: {
    runs: number;
    fingerprints: StartupFingerprint[];
    mismatches: string[];
  };
  stage5d: "NOT STARTED";
};

export type StartupOptions = {
  path?: string;
  entry?: string;
  consistencyRuns?: number;
};

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16).padStart(8, "0")}`;
}

function decodeGbkCstr(u8: Uint8Array): string {
  let n = 0;
  while (n < u8.length && u8[n]) n++;
  const slice = u8.subarray(0, n);
  try {
    return new TextDecoder("gbk").decode(slice);
  } catch {
    return String.fromCharCode(...slice);
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errType(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

function countOpcodes(p: ColdProto): { main: number; total: number; calls: number; globals: string[] } {
  let total = 0;
  let calls = 0;
  const globals: string[] = [];
  const walk = (f: ColdProto): void => {
    total += f.code.length;
    for (const insn of f.code) {
      const op = GET_OPCODE(insn);
      if (op === OP_CALL) calls++;
      if (op === OP_GETGLOBAL) {
        const c = f.k[GETARG_Bx(insn)];
        if (c && c.t === TAG_STRING) globals.push(c.s);
      }
    }
    for (const ch of f.p) walk(ch);
  };
  walk(p);
  return { main: p.code.length, total, calls, globals };
}

function wrapSlot(rt: MythroadRuntime, slot: { tag: number; num: number }, name: string, log: NativeCallRec[]): void {
  if (slot.tag !== TAG_FUNCTION) return;
  const cl = rt.lua.L.closures[slot.num];
  if (!cl || !cl.isC) return;
  const orig = cl.fn;
  cl.fn = (L) => {
    const preview = stackPreview(L, 8);
    try {
      const n = orig(L);
      log.push({ name, args: preview.arguments, nresults: n, ok: true });
      return n;
    } catch (e) {
      log.push({ name, args: preview.arguments, nresults: null, ok: false, error: errText(e) });
      throw e;
    }
  };
}

function wrapNamedNatives(rt: MythroadRuntime, log: NativeCallRec[]): void {
  const L = rt.lua.L;
  for (const name of ["_strCom", "_com", "GetSysInfo", "TestCom1", "TestCom"]) {
    wrapSlot(rt, L.getGlobal(name), name, log);
  }
  const str = L.getGlobal("string");
  if (str.tag === TAG_TABLE) {
    const tab = L.tables[str.num]!;
    wrapSlot(rt, tab.getStr(L.internStr("unpack")), "string.unpack", log);
  }
}

function snapCpu(e: ExtRuntime): CpuSnap {
  const r = e.cpu.r;
  const sp = r[13] >>> 0;
  return {
    pc: r[15] >>> 0,
    cpsr: e.cpu.cpsr >>> 0,
    r0: r[0] >>> 0,
    r1: r[1] >>> 0,
    r2: r[2] >>> 0,
    r3: r[3] >>> 0,
    r4: r[4] >>> 0,
    r5: r[5] >>> 0,
    r6: r[6] >>> 0,
    r7: r[7] >>> 0,
    r8: r[8] >>> 0,
    r9: r[9] >>> 0,
    sp,
    lr: r[14] >>> 0,
    tBit: e.cpu.t & 1,
    insnCount: e.cpu.insnCount | 0,
    stack0: e.mem.read32(sp) >>> 0,
    stack4: e.mem.read32((sp + 4) >>> 0) >>> 0,
    stack8: e.mem.read32((sp + 8) >>> 0) >>> 0,
    stack12: e.mem.read32((sp + 12) >>> 0) >>> 0,
  };
}

function strComFromNatives(natives: NativeCallRec[]): RealMrpStartupReport["lua"]["strCom"] {
  const out: RealMrpStartupReport["lua"]["strCom"] = [];
  for (const n of natives) {
    if (n.name !== "_strCom" && n.name !== "TestCom1") continue;
    const code = typeof n.args[0] === "number" ? (n.args[0] as number) | 0 : 0;
    const extra = typeof n.args[2] === "number" ? (n.args[2] as number) | 0 : 0;
    out.push({ code, extra, ok: n.ok, nresults: n.nresults });
  }
  return out;
}

function strCom801(natives: NativeCallRec[], extCalls: ExtCallRec[]): RealMrpStartupReport["lua"]["strCom801"] {
  const srcs = natives.filter((n) => {
    if (n.name !== "_strCom" && n.name !== "TestCom1") return false;
    return typeof n.args[0] === "number" && ((n.args[0] as number) | 0) === 801;
  });
  return srcs.map((n, i) => {
    const extra = typeof n.args[2] === "number" ? (n.args[2] as number) | 0 : 0;
    const call = extCalls[i];
    return {
      code: 801,
      extra,
      returnedToLua: n.ok,
      r0: call && call.ok ? call.r0 : null,
      nresults: n.nresults,
      error: n.error,
    };
  });
}

function vfsReads(records: TraceRecord[]): string[] {
  const out: string[] = [];
  for (const r of records) {
    if (r.operation !== "vfs_read") continue;
    const a = r.arguments as { name?: string } | null;
    if (a && typeof a.name === "string") out.push(a.name);
  }
  return out;
}

function loadRets(records: TraceRecord[]): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.operation !== "ext_load_return") continue;
    const a = r.arguments as { ret?: number } | null;
    if (a && typeof a.ret === "number") out.push(a.ret | 0);
  }
  return out;
}

function fingerprintOf(p: {
  firstUnknownSlot: number | null;
  stopPc: number;
  p: number;
  helper: number;
  erRw: number;
  rwLen: number;
  armInsnCount: number;
  luaInsnCount: number;
  natives: NativeCallRec[];
  tableSlots: number[];
  vfs: string[];
}): StartupFingerprint {
  return {
    firstUnknownSlot: p.firstUnknownSlot,
    stopPc: p.stopPc,
    p: p.p,
    helper: p.helper,
    erRw: p.erRw,
    rwLen: p.rwLen,
    armInsnCount: p.armInsnCount,
    luaInsnCount: p.luaInsnCount,
    luaNativeSeq: JSON.stringify(
      p.natives.map((n) => ({
        name: n.name,
        args: n.args,
        ok: n.ok,
      })),
    ),
    tableSlots: p.tableSlots.slice(),
    vfsReads: p.vfs.slice(),
  };
}

function fpKey(f: StartupFingerprint): string {
  return JSON.stringify(f);
}

function diffFingerprints(a: StartupFingerprint, b: StartupFingerprint): string[] {
  const keys: (keyof StartupFingerprint)[] = [
    "firstUnknownSlot",
    "stopPc",
    "p",
    "helper",
    "erRw",
    "rwLen",
    "armInsnCount",
    "luaInsnCount",
    "luaNativeSeq",
    "tableSlots",
    "vfsReads",
  ];
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

function describeTable38ReturnConsumer(hits: TableHit[]): string {
  const i = hits.findIndex((h) => h.slot === 38);
  if (i < 0) return "not reached";
  const h38 = hits[i]!;
  if (h38.status !== "REAL_EXECUTED") return "not returned (NOT_EXECUTED)";
  const next = hits[i + 1];
  if (!next) return "none (no following slot)";
  const ret = h38.return;
  const nextR0 = next.arguments[0]!;
  if (ret === 0 && nextR0 === 0) {
    return `LIVE leftover MR_SUCCESS at table[${next.slot}] r0=0 — investigate`;
  }
  return `none / overwritten before use (next table[${next.slot}] r0=${hx(nextR0)})`;
}

function firstUnknownAfter130(hits: TableHit[], unknownSlot: number | null): string {
  const i130 = hits.findIndex((h) => h.slot === 130);
  const later = i130 >= 0 ? hits.slice(i130 + 1) : hits;
  const blocked = later.find((h) => h.status === "NOT_EXECUTED");
  if (blocked) return `table[${blocked.slot}]`;
  if (unknownSlot !== null) return `table[${unknownSlot}]`;
  return "(none)";
}

function slotRow(
  slot: number,
  hits: TableHit[],
  handlers: Map<number, boolean>,
  productionNote: string,
): SlotStatusRow {
  const reached = hits.some((h) => h.slot === slot);
  const present = handlers.get(slot) === true;
  if (reached && present) {
    return {
      slot,
      status: "REAL_EXECUTED",
      guestReached: true,
      handlerPresent: true,
      note: "guest BLX + host handler returned",
    };
  }
  if (reached && !present) {
    return {
      slot,
      status: "NOT_EXECUTED",
      guestReached: true,
      handlerPresent: false,
      note: productionNote,
    };
  }
  return {
    slot,
    status: "NOT_EXECUTED",
    guestReached: false,
    handlerPresent: present,
    note: "not reached on production path",
  };
}

type OneRun = {
  natives: NativeCallRec[];
  hits: TableHit[];
  extCalls: ExtCallRec[];
  cpu130: CpuSnap | null;
  cpu38: CpuSnap | null;
  cpu: CpuSnap | null;
  p: number;
  helper: number;
  erRw: number;
  rwLen: number;
  erRwPlus1c: number;
  luaInsnCount: number;
  unknownSlot: number | null;
  thrown: string;
  thrownType: string;
  isLuaVmError: boolean;
  chunkReturned: boolean;
  startMrBytes: number;
  cfunctionBytes: number;
  handlerMap: Map<number, boolean>;
  owner: string;
  records: TraceRecord[];
  luaLoaded: boolean;
};

function runOnce(mrp: Uint8Array, entry: string): OneRun {
  const tr = new RuntimeTrace();
  const rt = new MythroadRuntime({ graphics: new NullGraphicsBackend(), trace: tr, abiMode: "strict" });
  const natives: NativeCallRec[] = [];
  wrapNamedNatives(rt, natives);

  const hits: TableHit[] = [];
  const extCalls: ExtCallRec[] = [];
  let cpu130: CpuSnap | null = null;
  let cpu38: CpuSnap | null = null;
  let cpu: CpuSnap | null = null;
  let p = 0;
  let helper = 0;
  let erRw = 0;
  let rwLen = 0;
  const handlerMap = new Map<number, boolean>();

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    origBind(ext);
    const e = rt.ext;
    if (!e) return;

    const origCall = e.arm_ext_call.bind(e);
    e.arm_ext_call = (code, input, inputAddr, inputLen) => {
      try {
        const out = origCall(code, input, inputAddr, inputLen);
        extCalls.push({
          code,
          ok: true,
          r0: out.r0 | 0,
          kind: out.kind,
          insnCount: out.insnCount | 0,
        });
        return out;
      } catch (err) {
        extCalls.push({
          code,
          ok: false,
          r0: null,
          kind: null,
          insnCount: e.cpu.insnCount | 0,
          error: errText(err),
        });
        throw err;
      }
    };

    const origD = e.table.dispatch.bind(e.table);
    e.table.dispatch = (c, mem, pc) => {
      const n = tableSlotIndex(pc);
      const had = !!e.table.handlers[n];
      handlerMap.set(n, had);
      const hit: TableHit = {
        slot: n,
        callsite: c.r[14] >>> 0,
        arguments: [c.r[0] >>> 0, c.r[1] >>> 0, c.r[2] >>> 0, c.r[3] >>> 0],
        return: null,
        status: had ? "REAL_EXECUTED" : "NOT_EXECUTED",
        note: had
          ? n === 130
            ? "REAL_EXECUTED case 7 (rxgj FULL)"
            : n === 38
              ? "REAL_EXECUTED mr_platEx 0x4c6 (rxgj FULL); no side effects"
              : "host handler"
          : "NOT_EXECUTED by host",
        pc: pc >>> 0,
        lr: c.r[14] >>> 0,
        r9: c.r[9] >>> 0,
        sp: c.r[13] >>> 0,
      };
      hits.push(hit);
      if (n === 130) {
        cpu130 = snapCpu(e);
        p = e.owners.wrapper.p >>> 0;
        helper = e.owners.wrapper.helper >>> 0;
        erRw = p ? e.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0 : 0;
        rwLen = p ? e.mem.read32(p + AEX_P_ER_RW_LEN_OFF) >>> 0 : 0;
      }
      if (n === 38) cpu38 = snapCpu(e);
      if (!had) cpu = snapCpu(e);
      handlerMap.set(130, !!e.table.handlers[130]);
      handlerMap.set(38, !!e.table.handlers[38]);
      handlerMap.set(33, !!e.table.handlers[33]);
      handlerMap.set(0, !!e.table.handlers[0]);
      handlerMap.set(14, !!e.table.handlers[14]);
      handlerMap.set(25, !!e.table.handlers[25]);
      handlerMap.set(125, !!e.table.handlers[125]);
      origD(c, mem, pc);
      if (had) hit.return = c.r[0] >>> 0;
    };
  };

  let thrown = "";
  let thrownType = "";
  let isLuaVmError = false;
  let chunkReturned = false;
  try {
    rt.loadMrp(mrp);
    rt.start(entry);
    chunkReturned = true;
  } catch (e) {
    thrown = errText(e);
    thrownType = errType(e);
    isLuaVmError = e instanceof LuaRuntimeError;
  }

  const cf = rt.mrReads.find((r) => r.name === "cfunction.ext" && r.lookfor === 0);
  const startRead = tr.records.find((r) => {
    if (r.operation !== "vfs_read") return false;
    return (r.arguments as { name?: string } | null)?.name === "start.mr";
  });

  if (!p && rt.ext) {
    p = rt.ext.owners.wrapper.p >>> 0;
    helper = rt.ext.owners.wrapper.helper >>> 0;
    erRw = p ? rt.ext.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0 : 0;
    rwLen = p ? rt.ext.mem.read32(p + AEX_P_ER_RW_LEN_OFF) >>> 0 : 0;
  }
  const erRwPlus1c = rt.ext && erRw ? rt.ext.mem.read32(erRw + 0x1c) >>> 0 : 0;

  return {
    natives,
    hits,
    extCalls,
    cpu130,
    cpu38,
    cpu,
    p,
    helper,
    erRw,
    rwLen,
    erRwPlus1c,
    luaInsnCount: rt.lua.L.insnCount | 0,
    unknownSlot: rt.unknownRequiredSlot,
    thrown,
    thrownType,
    isLuaVmError,
    chunkReturned,
    startMrBytes: typeof startRead?.returnValue === "number" ? startRead.returnValue : 0,
    cfunctionBytes: cf?.length ?? 0,
    handlerMap,
    owner: rt.packName || "wrapper",
    records: tr.records.slice(),
    luaLoaded: tr.records.some((r) => r.operation === "lua_chunk"),
  };
}

function progressOf(run: OneRun, loads: number[]): ProgressRow[] {
  const code6 = run.extCalls.find((c) => c.code === 6);
  const code0 = run.extCalls.find((c) => c.code === 0);
  const pass = (ok: boolean): StagePass => (ok ? "PASS" : "BLOCKED");
  const i130 = run.hits.findIndex((h) => h.slot === 130);
  const hit130 = i130 >= 0 ? run.hits[i130]! : null;
  const post14 = i130 >= 0 && run.hits.slice(i130 + 1).some((h) => h.slot === 14);
  const hit38 = run.hits.find((h) => h.slot === 38);
  const hit33 = run.hits.find((h) => h.slot === 33);
  const t130ok = hit130?.status === "REAL_EXECUTED";
  const t38blocked = !!hit38 && hit38.status === "NOT_EXECUTED";
  const t33blocked = !!hit33 && hit33.status === "NOT_EXECUTED";
  return [
    { stage: "MRP parse", status: "PASS", note: "real app.mrp parsed" },
    {
      stage: "start.mr",
      status: pass(run.luaLoaded && run.startMrBytes > 0),
      note: "first start.mr loaded and executed until host stop",
    },
    {
      stage: "mrc_loader.ext",
      status: pass(loads.includes(3)),
      note: loads.includes(3) ? "arm_ext_load r0=3" : "mrc_loader load not observed",
    },
    {
      stage: "cfunction.ext",
      status: pass(loads.includes(0) && run.cfunctionBytes > 0),
      note: run.cfunctionBytes ? `${run.cfunctionBytes} bytes via table[125]` : "cfunction not loaded",
    },
    {
      stage: "cfunction init",
      status: pass(!!run.p && !!run.helper && run.rwLen > 0),
      note: run.p ? `P=${hx(run.p)} helper=${hx(run.helper)}` : "P not set",
    },
    {
      stage: "code6",
      status: pass(!!code6 && code6.ok && code6.r0 === 0),
      note: code6?.ok ? "arm_ext_call(6) guest return 0" : "code 6 not returned",
    },
    {
      stage: "code0 entry",
      status: pass(!!code0),
      note: code0 ? "arm_ext_call(0) entered mrc_init" : "code 0 not called",
    },
    {
      stage: "table130",
      status: t130ok ? "PASS" : hit130 ? "BLOCKED" : "NOT REACHED",
      note: t130ok ? "REAL_EXECUTED case 7 (rxgj FULL)" : "table[130] not REAL_EXECUTED",
    },
    {
      stage: "table14 post-130",
      status: post14 ? "PASS" : "NOT REACHED",
      note: post14 ? "REAL_EXECUTED memset after TestCom" : "no table[14] after 130",
    },
    {
      stage: "table38",
      status: t38blocked ? "BLOCKED" : hit38?.status === "REAL_EXECUTED" ? "PASS" : hit38 ? "BLOCKED" : "NOT REACHED",
      note: t38blocked
        ? "UNKNOWN_REQUIRED_SLOT; NOT_EXECUTED by host"
        : hit38?.status === "REAL_EXECUTED"
          ? "REAL_EXECUTED mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL); no side effects"
          : hit38
            ? "reached"
            : "not reached",
    },
    {
      stage: "table33",
      status: t33blocked ? "BLOCKED" : hit33 ? "PASS" : "NOT REACHED",
      note: t33blocked
        ? "UNKNOWN_REQUIRED_SLOT; NOT_EXECUTED by host"
        : hit33
          ? "guest reached table[33]"
          : "not reached on production path",
    },
  ];
}

/**
 * Production-path baseline against a real MRP. No unknown-slot handlers. No cbRet bypass.
 */
export function runRealMrpStartup(mrp: Uint8Array, opts: StartupOptions = {}): RealMrpStartupReport {
  const path = opts.path ?? "test/fixtures/real/app.mrp";
  const entry = opts.entry ?? "start.mr";
  const nRuns = Math.max(1, opts.consistencyRuns ?? 5);

  const inspect = inspectBytes(mrp, { fixtureKind: "real" });
  const arc = MRPArchive.parse(mrp);
  const startBytes = arc.readFile(entry);
  if (!startBytes) throw new LuaRuntimeError(`real ${entry} missing`);
  const proto = LuaChunkReader.load(startBytes);
  const ops = countOpcodes(proto);

  const fingerprints: StartupFingerprint[] = [];
  let first: OneRun | null = null;

  for (let i = 0; i < nRuns; i++) {
    const run = runOnce(mrp, entry);
    if (!first) first = run;
    fingerprints.push(
      fingerprintOf({
        firstUnknownSlot: run.unknownSlot,
        stopPc: run.cpu?.pc ?? 0,
        p: run.p,
        helper: run.helper,
        erRw: run.erRw,
        rwLen: run.rwLen,
        armInsnCount: run.cpu?.insnCount ?? 0,
        luaInsnCount: run.luaInsnCount,
        natives: run.natives,
        tableSlots: run.hits.map((h) => h.slot),
        vfs: vfsReads(run.records),
      }),
    );
  }

  const run = first!;
  const loads = loadRets(run.records);
  const mismatches = new Set<string>();
  for (let i = 1; i < fingerprints.length; i++) {
    for (const k of diffFingerprints(fingerprints[0]!, fingerprints[i]!)) mismatches.add(k);
  }

  const code0 = [...run.extCalls].reverse().find((c) => !c.ok) ?? run.extCalls.find((c) => c.code === 0) ?? null;
  const strCom = strComFromNatives(run.natives);
  const s801 = strCom801(run.natives, run.extCalls);

  const slots: SlotStatusRow[] = [
    slotRow(0, run.hits, run.handlerMap, ""),
    slotRow(14, run.hits, run.handlerMap, ""),
    slotRow(25, run.hits, run.handlerMap, ""),
    slotRow(125, run.hits, run.handlerMap, ""),
    slotRow(130, run.hits, run.handlerMap, "NOT_EXECUTED by host"),
    slotRow(38, run.hits, run.handlerMap, "NOT_EXECUTED by host"),
    slotRow(33, run.hits, run.handlerMap, "NOT_EXECUTED by host"),
  ];

  const handlerSlots = [0, 14, 25, 125, 130, 38, 33];
  const handlers = handlerSlots.map((slot) => ({
    slot,
    present: run.handlerMap.get(slot) === true,
  }));

  return {
    mrp: {
      path,
      size: mrp.length,
      sha256: inspect.sha256,
      package: arc.header.filename,
      appname: decodeGbkCstr(mrp.subarray(28, 52)),
      resourceCount: arc.entries.length,
    },
    vfs: { reads: vfsReads(run.records) },
    lua: {
      realStartMrLoaded: run.luaLoaded && run.startMrBytes > 0,
      startMrBytes: run.startMrBytes,
      opcodeCountMain: ops.main,
      opcodeCountTotal: ops.total,
      opcodeCallCount: ops.calls,
      getglobalNames: ops.globals,
      luaInsnCount: run.luaInsnCount,
      nativeCalls: run.natives,
      strCom,
      strCom801: s801,
      chunkReturned: run.chunkReturned,
      exception: run.thrown
        ? { type: run.thrownType, message: run.thrown, isLuaVmError: run.isLuaVmError }
        : null,
    },
    ext: {
      mrcLoaderLoad: loads.includes(3),
      mrcLoaderRet: loads.includes(3) ? 3 : loads[0] ?? null,
      cfunctionLoad: loads.includes(0) && run.cfunctionBytes > 0,
      cfunctionRet: loads.includes(0) ? 0 : null,
      cfunctionBytes: run.cfunctionBytes,
      p: run.p,
      helper: run.helper,
      erRw: run.erRw,
      rwLen: run.rwLen,
      erRwPlus1c: run.erRwPlus1c,
      calls: run.extCalls,
    },
    execution: {
      armExtCallCode: code0?.code ?? 0,
      cpu130: run.cpu130,
      cpu38: run.cpu38,
      cpu: run.cpu,
      table38Return: run.hits.find((h) => h.slot === 38)?.return ?? null,
      table38ReturnConsumer: describeTable38ReturnConsumer(run.hits),
    },
    mrTable: { hits: run.hits, slots, handlers },
    stop: {
      reason: run.thrown || "(completed)",
      pc: run.cpu?.pc ?? null,
      slot: run.unknownSlot,
      owner: run.owner,
    },
    progress: progressOf(run, loads),
    baseline: {
      deterministic: mismatches.size === 0 && fingerprints.every((f) => fpKey(f) === fpKey(fingerprints[0]!)),
      firstProductionBlocker: run.unknownSlot !== null ? `table[${run.unknownSlot}]` : "(none)",
      firstPost130Blocker: firstUnknownAfter130(run.hits, run.unknownSlot),
    },
    forensicPrior: {
      table130: run.hits.find((h) => h.slot === 130)?.status ?? "NOT_EXECUTED",
      table38: run.hits.find((h) => h.slot === 38)?.status ?? "NOT_EXECUTED",
      table33: run.hits.find((h) => h.slot === 33)?.status ?? "NOT_EXECUTED",
      note: "This run does not cbRet unknown slots. table[38] is REAL_EXECUTED code 0x4c6 only, not FORENSIC_BYPASSED. table[33] is not implemented.",
    },
    consistency: {
      runs: nRuns,
      fingerprints,
      mismatches: [...mismatches],
    },
    stage5d: "NOT STARTED",
  };
}

export function renderRealMrpStartupMarkdown(r: RealMrpStartupReport): string {
  const cpu = r.execution.cpu;
  const cpu130 = r.execution.cpu130;
  const cpu38 = r.execution.cpu38;
  const lines = [
    "# Real MRP Startup (Stage 5-C.10C)",
    "",
    "Production path. table[130] case 7 + table[38] code 0x4c6 only (rxgj FULL).",
    "No forensic bypass. No backlight / Canvas / DOM. Stage 5-D: **NOT STARTED**.",
    "",
    "This is rxgj FULL compatibility behavior for the observed",
    "`mr_platEx(0x4c6, NULL, 0, NULL, NULL, NULL)` call.",
    "It is not claimed to implement the complete `mr_platEx` API",
    "or universal Mythroad platform behavior.",
    "",
    "## MRP",
    "",
    `- path: \`${r.mrp.path}\``,
    `- size: ${r.mrp.size}`,
    `- sha256: \`${r.mrp.sha256}\``,
    `- package: ${r.mrp.package}`,
    `- appname: ${r.mrp.appname}`,
    `- resource count: ${r.mrp.resourceCount}`,
    "",
    "## VFS",
    "",
    ...r.vfs.reads.map((n) => `- ${n}`),
    "",
    "## Lua",
    "",
    `- real start.mr loaded: ${r.lua.realStartMrLoaded}`,
    `- start.mr bytes: ${r.lua.startMrBytes}`,
    `- opcode count (main/total): ${r.lua.opcodeCountMain}/${r.lua.opcodeCountTotal}`,
    `- CALL opcodes: ${r.lua.opcodeCallCount}`,
    `- GETGLOBAL: ${r.lua.getglobalNames.join(", ")}`,
    `- lua insnCount: ${r.lua.luaInsnCount}`,
    `- chunk returned: ${r.lua.chunkReturned}`,
    `- Lua VM error: ${r.lua.exception?.isLuaVmError ? "yes" : "no"}`,
    `- exception: ${r.lua.exception ? `${r.lua.exception.type}: ${r.lua.exception.message}` : "(none)"}`,
    "",
    "### native calls",
    "",
    ...r.lua.nativeCalls.map(
      (n) =>
        `- ${n.ok ? "REAL_EXECUTED" : "NOT_EXECUTED"} ${n.name}(${n.args.map(String).join(", ")}) nresults=${n.nresults}${n.error ? ` error=${n.error}` : ""}`,
    ),
    "",
    "### _strCom",
    "",
    ...r.lua.strCom.map((s) => `- _strCom(${s.code}, …, ${s.extra}) ok=${s.ok} nresults=${s.nresults}`),
    "",
    "### _strCom(801) → Lua",
    "",
    ...r.lua.strCom801.map(
      (s) =>
        `- extra=${s.extra} returnedToLua=${s.returnedToLua} r0=${s.r0} nresults=${s.nresults}${s.error ? ` error=${s.error}` : ""}`,
    ),
    "",
    "## EXT",
    "",
    `- mrc_loader load: ${r.ext.mrcLoaderLoad} ret=${r.ext.mrcLoaderRet}`,
    `- cfunction load: ${r.ext.cfunctionLoad} ret=${r.ext.cfunctionRet} bytes=${r.ext.cfunctionBytes}`,
    `- P: ${hx(r.ext.p)}`,
    `- helper: ${hx(r.ext.helper)}`,
    `- ER_RW: ${hx(r.ext.erRw)}`,
    `- rwLen: ${r.ext.rwLen}`,
    `- ER_RW+0x1c: ${hx(r.ext.erRwPlus1c)}`,
    "",
    ...r.ext.calls.map(
      (c) =>
        `- arm_ext_call(${c.code}) ok=${c.ok} r0=${c.r0} kind=${c.kind} insns=${c.insnCount}${c.error ? ` error=${c.error}` : ""}`,
    ),
    "",
    "## Execution",
    "",
    `- arm_ext_call code: ${r.execution.armExtCallCode}`,
    `- table38 return: ${r.execution.table38Return === null ? "—" : hx(r.execution.table38Return)}`,
    `- table38 return consumer: ${r.execution.table38ReturnConsumer}`,
    cpu130
      ? [
          "### table[130] entry",
          `- PC: ${hx(cpu130.pc)}`,
          `- R0-R3: ${hx(cpu130.r0)} ${hx(cpu130.r1)} ${hx(cpu130.r2)} ${hx(cpu130.r3)}`,
          `- R9: ${hx(cpu130.r9)} SP: ${hx(cpu130.sp)} LR: ${hx(cpu130.lr)}`,
        ].join("\n")
      : "- table[130] CPU: (none)",
    cpu38
      ? [
          "### table[38] entry",
          `- PC: ${hx(cpu38.pc)}`,
          `- R0-R3: ${hx(cpu38.r0)} ${hx(cpu38.r1)} ${hx(cpu38.r2)} ${hx(cpu38.r3)}`,
          `- [SP+0]/[SP+4]: ${hx(cpu38.stack0)} ${hx(cpu38.stack4)}`,
          `- R9: ${hx(cpu38.r9)} SP: ${hx(cpu38.sp)} LR: ${hx(cpu38.lr)}`,
        ].join("\n")
      : "- table[38] CPU: (none)",
    cpu
      ? [
          "### STOP CPU",
          `- PC: ${hx(cpu.pc)}`,
          `- CPSR: ${hx(cpu.cpsr)}`,
          `- R0-R3: ${hx(cpu.r0)} ${hx(cpu.r1)} ${hx(cpu.r2)} ${hx(cpu.r3)}`,
          `- R4-R8: ${hx(cpu.r4)} ${hx(cpu.r5)} ${hx(cpu.r6)} ${hx(cpu.r7)} ${hx(cpu.r8)}`,
          `- R9: ${hx(cpu.r9)}`,
          `- SP: ${hx(cpu.sp)}`,
          `- LR: ${hx(cpu.lr)}`,
          `- stack: ${hx(cpu.stack0)} ${hx(cpu.stack4)} ${hx(cpu.stack8)} ${hx(cpu.stack12)}`,
          `- T: ${cpu.tBit} insnCount=${cpu.insnCount}`,
        ].join("\n")
      : "- STOP CPU: (none)",
    "",
    "## mr_table",
    "",
    ...r.mrTable.hits.map(
      (h) =>
        `- slot ${h.slot} ${h.status} callsite=${hx(h.callsite)} args=(${h.arguments.map(hx).join(", ")}) return=${h.return === null ? "—" : hx(h.return)} ${h.note}`,
    ),
    "",
    "### slot status (do not mix)",
    "",
    ...r.mrTable.slots.map(
      (s) =>
        `- table[${s.slot}] = ${s.status}${s.guestReached ? " guestReached" : " not-reached"} handler=${s.handlerPresent} — ${s.note}`,
    ),
    "",
    "### handlers",
    "",
    ...r.mrTable.handlers.map((h) => `- table[${h.slot}] handler=${h.present}`),
    "",
    "## STOP",
    "",
    `- reason: ${r.stop.reason}`,
    `- PC: ${r.stop.pc === null ? "—" : hx(r.stop.pc)}`,
    `- slot: ${r.stop.slot}`,
    `- owner: ${r.stop.owner}`,
    "",
    "## Progress (PASS = real guest execution only)",
    "",
    "```",
    "Stage              Status",
    "--------------------------------",
    ...r.progress.map((p) => `${p.stage.padEnd(18)} ${p.status}`),
    "```",
    "",
    ...r.progress.map((p) => `- ${p.stage}: **${p.status}** — ${p.note}`),
    "",
    "## REAL MRP BASELINE",
    "",
    "```",
    "REAL MRP BASELINE:",
    `  deterministic: ${r.baseline.deterministic ? "yes" : "no"}`,
    `  first production blocker: ${r.baseline.firstProductionBlocker}`,
    `  first post-130 blocker: ${r.baseline.firstPost130Blocker}`,
    "```",
    "",
    r.consistency.mismatches.length
      ? `- consistency mismatches: ${r.consistency.mismatches.join(", ")}`
      : `- consistency: ${r.consistency.runs} runs identical`,
    "",
    "## Slot status (this run)",
    "",
    `- 130 = ${r.forensicPrior.table130} (case 7 only; not the full TestCom switch)`,
    `- 38 = ${r.forensicPrior.table38} (code 0x4c6 only; not the complete mr_platEx API)`,
    `- 33 = ${r.forensicPrior.table33}`,
    `- ${r.forensicPrior.note}`,
    "",
    "## Stage 5-D",
    "",
    r.stage5d,
    "",
  ];
  return lines.join("\n");
}
