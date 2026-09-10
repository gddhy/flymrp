/**
 * Stage 5-C.10D — table[33] / asm_mr_getTime ABI forensics.
 * Read-only. Does not register table[33]. No Date.now / performance.now.
 */
import { AEX_P_ER_RW_OFF, EXT_CODE_ADDR, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { decodeThumb16, isThumb32Prefix } from "../hot/decode-thumb16.ts";
import { decodeThumb32 } from "../hot/decode-thumb32.ts";
import { OP_NAMES, Op, unpackW0 } from "../hot/opcodes.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { extractNamedExt } from "./code6.ts";
import { PLATEX38 } from "./platex38.ts";
import { runProductionCode0Fault } from "./code0chain.ts";

const PACK = new Uint32Array(3);

/** Pack-local addresses. Forensics only — not an implementation. */
export const GETTIME33 = {
  slot: 33,
  stub: 0x00010084,
  tableOff: 0x84,
  wrap: 0x01ea7ce8,
  wrapBlx: 0x01ea7cf4,
  wrapPop: 0x01ea7cf6,
  callerFn: 0x01ea7f68,
  callerPlatExBl: 0x01ea7f72,
  callerGetTimeBl: 0x01ea7f76,
  callerStoreBl: 0x01ea7f7a,
  storeFn: 0x01ea92c8,
  wrapB: 0x01ea94d8,
  wrapC: 0x01ea9674,
  wrapD: 0x01ea96a8,
  erOff: 0x4358,
  erConsumer: 0x01ea8c0c,
  init2: PLATEX38.init2,
  enc: {
    wrapBlx: 0x4780,
    storeLdrPc: 0x4901,
    storeAddR9: 0x4449,
    storeStr: 0x6008,
    storeBx: 0x4770,
    gotLdr38: 0x6b80,
    gotAdd80: 0x3080,
    gotLdr4: 0x6840,
  },
} as const;

export type GetTime33Cpu = {
  r: number[];
  pc: number;
  lr: number;
  sp: number;
  r9: number;
  cpsr: number;
  tBit: number;
  insnCount: number;
  stack0: number;
  stack4: number;
  stack8: number;
  stack12: number;
};

export type ThumbLine = { pc: number; size: number; op: number; text: string; target: number | null };

export type GetTime33Bl = { from: number; to: number };

export type GetTime33GotSite = {
  va: number;
  around: ThumbLine[];
};

export type GetTime33Report = {
  handler130: boolean;
  handler38: boolean;
  handler33: boolean;
  productionThrown: string;
  probeThrown: string;
  cpu: GetTime33Cpu;
  p: number;
  helper: number;
  erRw: number;
  owner: string;
  encodings: {
    wrap: ThumbLine[];
    caller: ThumbLine[];
    storeFn: ThumbLine[];
    wrapB: ThumbLine[];
    wrapC: ThumbLine[];
    wrapD: ThumbLine[];
    erConsumer: ThumbLine[];
    wrapBlx: number;
    storeHw: [number, number, number, number];
    callerGetTimeBl: number;
    callerGetTimeTarget: number | null;
    callerStoreBl: number;
    callerStoreTarget: number | null;
    storeLiteral: number;
  };
  gotSequences: number[];
  gotSites: GetTime33GotSite[];
  wrapXrefs: GetTime33Bl[];
  storeXrefs: GetTime33Bl[];
  literals4358: number[];
  init2Reached: boolean;
};

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

type Mem16 = { read16: (a: number) => number };

function fmtThumb(pc: number, mem: Mem16): ThumbLine {
  const hw1 = mem.read16(pc);
  if (isThumb32Prefix(hw1)) {
    const hw2 = mem.read16((pc + 2) >>> 0);
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
  return {
    pc,
    size: 2,
    op: u.op,
    target: null,
    text: `${hx(pc)}  ${hw1.toString(16).padStart(4, "0")}  ${OP_NAMES[u.op] ?? u.op} rd=${u.rd} rn=${u.rn} rm=${u.rm} imm=${hx(PACK[1]!)}${extra}`,
  };
}

function disasmRange(mem: Mem16, start: number, end: number): ThumbLine[] {
  const out: ThumbLine[] = [];
  let p = start >>> 0;
  while (p < end) {
    const d = fmtThumb(p, mem);
    out.push(d);
    p = (p + d.size) >>> 0;
  }
  return out;
}

function snapCpu(e: ExtRuntime): GetTime33Cpu {
  const r = [...e.cpu.r].map((v) => v >>> 0);
  const sp = r[13]!;
  return {
    r,
    pc: r[15]!,
    lr: r[14]!,
    sp,
    r9: r[9]!,
    cpsr: e.cpu.cpsr >>> 0,
    tBit: e.cpu.t & 1,
    insnCount: e.cpu.insnCount | 0,
    stack0: e.mem.read32(sp) >>> 0,
    stack4: e.mem.read32((sp + 4) >>> 0) >>> 0,
    stack8: e.mem.read32((sp + 8) >>> 0) >>> 0,
    stack12: e.mem.read32((sp + 12) >>> 0) >>> 0,
  };
}

function scanGotSequences(bytes: Uint8Array): number[] {
  const dest = EXT_CODE_ADDR;
  const hits: number[] = [];
  for (let i = 0; i + 7 < bytes.length; i += 2) {
    const a = bytes[i]! | (bytes[i + 1]! << 8);
    const b = bytes[i + 2]! | (bytes[i + 3]! << 8);
    const c = bytes[i + 4]! | (bytes[i + 5]! << 8);
    const d = bytes[i + 6]! | (bytes[i + 7]! << 8);
    if (
      a === GETTIME33.enc.gotLdr38 &&
      b === GETTIME33.enc.gotAdd80 &&
      c === GETTIME33.enc.gotLdr4 &&
      d === GETTIME33.enc.wrapBlx
    ) {
      hits.push((dest + i) >>> 0);
    }
  }
  return hits;
}

function findLe32(bytes: Uint8Array, value: number): number[] {
  const hits: number[] = [];
  const b0 = value & 0xff;
  const b1 = (value >>> 8) & 0xff;
  const b2 = (value >>> 16) & 0xff;
  const b3 = (value >>> 24) & 0xff;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === b0 && bytes[i + 1] === b1 && bytes[i + 2] === b2 && bytes[i + 3] === b3) {
      hits.push((EXT_CODE_ADDR + i) >>> 0);
    }
  }
  return hits;
}

function scanBlTo(mem: Mem16, start: number, end: number, targets: number[]): GetTime33Bl[] {
  const want = new Set(targets.map((t) => t >>> 0));
  const out: GetTime33Bl[] = [];
  let p = start >>> 0;
  while (p + 3 < end) {
    const hw1 = mem.read16(p);
    if (isThumb32Prefix(hw1)) {
      const hw2 = mem.read16((p + 2) >>> 0);
      decodeThumb32(hw1, hw2, PACK, 0);
      const u = unpackW0(PACK[0]!);
      if (u.op === Op.BL) {
        const to = (p + 4 + (PACK[1]! | 0)) >>> 0;
        if (want.has(to)) out.push({ from: p, to });
      }
      p = (p + 4) >>> 0;
    } else {
      p = (p + 2) >>> 0;
    }
  }
  return out;
}

/**
 * Production-path snapshot at table[33]. Does not register or skip slot 33.
 */
export function runGetTime33Forensics(mrp: Uint8Array): GetTime33Report {
  const productionThrown = runProductionCode0Fault(mrp);
  const cf = extractNamedExt(mrp, "cfunction.ext");
  const gotSequences = scanGotSequences(cf);
  const literals4358 = findLe32(cf, GETTIME33.erOff);

  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });

  let cpu: GetTime33Cpu | null = null;
  let p = 0;
  let helper = 0;
  let erRw = 0;
  let handler130 = false;
  let handler38 = false;
  let handler33 = false;
  let init2Reached = false;
  let wrap: ThumbLine[] = [];
  let caller: ThumbLine[] = [];
  let storeFn: ThumbLine[] = [];
  let wrapB: ThumbLine[] = [];
  let wrapC: ThumbLine[] = [];
  let wrapD: ThumbLine[] = [];
  let erConsumer: ThumbLine[] = [];
  let wrapBlx = 0;
  let storeHw: [number, number, number, number] = [0, 0, 0, 0];
  let callerGetTimeBl = 0;
  let callerGetTimeTarget: number | null = null;
  let callerStoreBl = 0;
  let callerStoreTarget: number | null = null;
  let storeLiteral = 0;
  let wrapXrefs: GetTime33Bl[] = [];
  let storeXrefs: GetTime33Bl[] = [];
  let gotSites: GetTime33GotSite[] = [];

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    origBind(ext);
    const e = rt.ext;
    if (!e) return;

    const prev = e.cpu.onBeforeFetch;
    e.cpu.onBeforeFetch = (c) => {
      if ((c.r[15] >>> 0) === GETTIME33.init2) init2Reached = true;
      return prev ? prev(c) : false;
    };

    const origD = e.table.dispatch.bind(e.table);
    e.table.dispatch = (c, mem, pc) => {
      const n = tableSlotIndex(pc);
      if (n === GETTIME33.slot && !cpu) {
        cpu = snapCpu(e);
        p = e.owners.wrapper.p >>> 0;
        helper = e.owners.wrapper.helper >>> 0;
        erRw = p ? e.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0 : 0;
        handler130 = !!e.table.handlers[130];
        handler38 = !!e.table.handlers[38];
        handler33 = !!e.table.handlers[33];
        wrap = disasmRange(e.mem, GETTIME33.wrap, GETTIME33.wrapPop + 2);
        caller = disasmRange(e.mem, GETTIME33.callerFn, GETTIME33.callerStoreBl + 8);
        storeFn = disasmRange(e.mem, GETTIME33.storeFn, GETTIME33.storeFn + 0x10);
        wrapB = disasmRange(e.mem, GETTIME33.wrapB, GETTIME33.wrapB + 0x28);
        wrapC = disasmRange(e.mem, GETTIME33.wrapC, GETTIME33.wrapC + 0x20);
        wrapD = disasmRange(e.mem, GETTIME33.wrapD, GETTIME33.wrapD + 0x30);
        erConsumer = disasmRange(e.mem, GETTIME33.erConsumer, GETTIME33.erConsumer + 0x24);
        wrapBlx = e.mem.read16(GETTIME33.wrapBlx);
        storeHw = [
          e.mem.read16(GETTIME33.storeFn),
          e.mem.read16(GETTIME33.storeFn + 2),
          e.mem.read16(GETTIME33.storeFn + 4),
          e.mem.read16(GETTIME33.storeFn + 6),
        ];
        const getBl = caller.find((l) => l.pc === GETTIME33.callerGetTimeBl);
        callerGetTimeBl = e.mem.read16(GETTIME33.callerGetTimeBl);
        callerGetTimeTarget = getBl?.target ?? null;
        const stBl = caller.find((l) => l.pc === GETTIME33.callerStoreBl);
        callerStoreBl = e.mem.read16(GETTIME33.callerStoreBl);
        callerStoreTarget = stBl?.target ?? null;
        storeLiteral = e.mem.read32(GETTIME33.storeFn + 8) >>> 0;
        wrapXrefs = scanBlTo(e.mem, EXT_CODE_ADDR, EXT_CODE_ADDR + cf.length, [
          GETTIME33.wrap,
          GETTIME33.wrapB,
          GETTIME33.wrapC,
          GETTIME33.wrapD,
        ]);
        storeXrefs = scanBlTo(e.mem, EXT_CODE_ADDR, EXT_CODE_ADDR + cf.length, [GETTIME33.storeFn]);
        gotSites = gotSequences.map((va) => ({
          va,
          around: disasmRange(e.mem, (va - 0x10) >>> 0, (va + 8) >>> 0),
        }));
      }
      origD(c, mem, pc);
    };
  };

  let probeThrown = "";
  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
  } catch (err) {
    probeThrown = err instanceof Error ? err.message : String(err);
  }

  if (!cpu) throw new Error("table[33] was not reached");

  return {
    handler130,
    handler38,
    handler33,
    productionThrown,
    probeThrown,
    cpu,
    p,
    helper,
    erRw,
    owner: rt.packName || "wrapper",
    encodings: {
      wrap,
      caller,
      storeFn,
      wrapB,
      wrapC,
      wrapD,
      erConsumer,
      wrapBlx,
      storeHw,
      callerGetTimeBl,
      callerGetTimeTarget,
      callerStoreBl,
      callerStoreTarget,
      storeLiteral,
    },
    gotSequences,
    gotSites,
    wrapXrefs,
    storeXrefs,
    literals4358,
    init2Reached,
  };
}

export function renderGetTime33Markdown(r: GetTime33Report): string {
  const c = r.cpu;
  const xrefs = (to: number) =>
    r.wrapXrefs
      .filter((x) => x.to === to)
      .map((x) => hx(x.from))
      .join(" ");
  return [
    "# table[33] / asm_mr_getTime forensics (Stage 5-C.10D)",
    "",
    "Forensics only. **table[33] is not implemented. Stage 5-D NOT STARTED.**",
    "",
    "## LIVE CPU at stub",
    "",
    "```text",
    `PC    ${hx(c.pc)}`,
    `LR    ${hx(c.lr)}`,
    `SP    ${hx(c.sp)}`,
    `R0-R3 ${[c.r[0], c.r[1], c.r[2], c.r[3]].map(hx).join(" ")}`,
    `R4-R8 ${c.r.slice(4, 9).map(hx).join(" ")}`,
    `R9    ${hx(c.r9)}`,
    `CPSR  ${hx(c.cpsr)} T=${c.tBit} insn=${c.insnCount}`,
    `stack ${[c.stack0, c.stack4, c.stack8, c.stack12].map(hx).join(" ")}`,
    `P     ${hx(r.p)} helper=${hx(r.helper)} ER_RW=${hx(r.erRw)} owner=${r.owner}`,
    "```",
    "",
    "## Wrapper 0x01ea7ce8 (this init call)",
    "",
    "```text",
    ...r.encodings.wrap.map((l) => l.text),
    "```",
    "",
    "## Caller 0x01ea7f68",
    "",
    "```text",
    ...r.encodings.caller.map((l) => l.text),
    "```",
    "",
    "## Store helper 0x01ea92c8",
    "",
    "```text",
    ...r.encodings.storeFn.map((l) => l.text),
    "```",
    "",
    "## Other GOT wraps (static; not executed this init)",
    "",
    "### 0x01ea94d8",
    "",
    "```text",
    ...r.encodings.wrapB.map((l) => l.text),
    "```",
    "",
    "### 0x01ea9674",
    "",
    "```text",
    ...r.encodings.wrapC.map((l) => l.text),
    "```",
    "",
    "### 0x01ea96a8",
    "",
    "```text",
    ...r.encodings.wrapD.map((l) => l.text),
    "```",
    "",
    "## ER_RW+0x4358 later site 0x01ea8c0c (static; not this init)",
    "",
    "```text",
    ...r.encodings.erConsumer.map((l) => l.text),
    "```",
    "",
    `- production throw: ${r.productionThrown}`,
    `- probe throw: ${r.probeThrown}`,
    `- handlers 130/38/33: ${r.handler130}/${r.handler38}/${r.handler33}`,
    `- getTime BL target: ${r.encodings.callerGetTimeTarget === null ? "—" : hx(r.encodings.callerGetTimeTarget)}`,
    `- store BL target: ${r.encodings.callerStoreTarget === null ? "—" : hx(r.encodings.callerStoreTarget)}`,
    `- store literal: ${hx(r.encodings.storeLiteral)}`,
    `- GOT 6b80 3080 6840 4780: ${r.gotSequences.map(hx).join(" ")}`,
    `- BL → wrap ${hx(GETTIME33.wrap)}: ${xrefs(GETTIME33.wrap)}`,
    `- BL → wrapB ${hx(GETTIME33.wrapB)}: ${xrefs(GETTIME33.wrapB)}`,
    `- BL → wrapC ${hx(GETTIME33.wrapC)}: ${xrefs(GETTIME33.wrapC)}`,
    `- BL → wrapD ${hx(GETTIME33.wrapD)}: ${xrefs(GETTIME33.wrapD)}`,
    `- BL → store ${hx(GETTIME33.storeFn)}: ${r.storeXrefs.map((x) => hx(x.from)).join(" ")}`,
    `- LE32 0x4358: ${r.literals4358.map(hx).join(" ")}`,
    `- 0x01ea9254 reached: ${r.init2Reached}`,
    "",
  ].join("\n");
}
