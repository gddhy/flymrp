/**
 * Stage 5-C.10F — table[17] / sprintf_ ABI forensics.
 * Read-only snapshot of the first LIVE table[17] entry.
 * Production now implements literal+%d (5-C.10G); this probe does not
 * add extra handlers or forensic bypass.
 */
import {
  AEX_P_ER_RW_OFF,
  EXT_BASE_ADDR,
  EXT_CODE_ADDR,
  EXT_MEM_SIZE,
  EXT_STACK_ADDR,
  EXT_STACK_SIZE,
  tableSlotIndex,
} from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { decodeThumb16, isThumb32Prefix } from "../hot/decode-thumb16.ts";
import { decodeThumb32 } from "../hot/decode-thumb32.ts";
import { OP_NAMES, Op, unpackW0 } from "../hot/opcodes.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { extractNamedExt } from "./code6.ts";
import { runProductionCode0Fault } from "./code0chain.ts";

const PACK = new Uint32Array(3);

/** Pack-local addresses. Forensics only — not an implementation. */
export const SPRINTF17 = {
  slot: 17,
  stub: 0x00010044,
  tableOff: 0x44,
  gotOff: 0x5c,
  wrap: 0x01e9a864,
  blx: 0x01e9a880,
  ret: 0x01e9a882,
  parent: 0x01e9a8d8,
  parentBl: 0x01e9a8f8,
  caller: 0x01ea7f68,
  callerBl: 0x01ea7f80,
  consumer: 0x01ea8cdc,
  printfBlx: 0x01e9a8a2,
  printfSlot: 26,
  printfStub: 0x00010068,
  printfGotOff: 0x20,
  buffer: 0x01e7ff74,
  format: 0x01eaf204,
  formatText: "res_lang%d.rc",
  expected: "res_lang0.rc",
  printfFmt: 0x01eaf214,
  printfFmtText: "Failed to read resource: %s\n",
  chnFmt: 0x01eb159c,
  chnFmtText: "%s/chn%d",
  langOff: 0x1e0c,
  localBufSize: 0x18,
  stackTop: (EXT_STACK_ADDR + EXT_STACK_SIZE) >>> 0,
  enc: {
    push: 0xb530,
    movR4: 0x1c04,
    movs0: 0x2000,
    subSp: 0xb089,
    ldrR1: 0x4915,
    strSp8: 0x9002,
    strSp4: 0x9001,
    movR2R4: 0x1c22,
    addR1Pc: 0x4479,
    ldrR3: 0x4b14,
    addR5Sp: 0xad03,
    addR3R9: 0x444b,
    ldrR3R3: 0x681b,
    movR0R5: 0x1c28,
    blxR3: 0x4798,
    movsR2: 0x2200,
    strSp0: 0x9200,
    movR1R5: 0x1c29,
  },
} as const;

export type Sprintf17Cpu = {
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

export type Sprintf17Callsite = {
  blx: number;
  gotLdr: number;
  rd: number;
  format: string;
  formatVa: number;
  specs: string[];
  varargCount: number;
  stackVarargs: boolean;
  live: boolean;
};

export type Sprintf17Region = { base: number; size: number };

export type Sprintf17Report = {
  handler130: boolean;
  handler38: boolean;
  handler33: boolean;
  handler17: boolean;
  productionThrown: string;
  probeThrown: string;
  cpu: Sprintf17Cpu;
  p: number;
  helper: number;
  erRw: number;
  owner: string;
  format: string;
  formatAscii: boolean;
  formatBytes: number[];
  bufferBytes: number[];
  bufferRegion: Sprintf17Region | null;
  regions: Sprintf17Region[];
  writableToStackTop: number;
  langPtr: number;
  langVal: number;
  got17: number;
  got26: number;
  encodings: {
    wrap: ThumbLine[];
    after: ThumbLine[];
    parent: ThumbLine[];
    caller: ThumbLine[];
    consumer: ThumbLine[];
    wrapHw: number[];
    afterHw: number[];
    litGot: number;
    litFmt: number;
    parentBlTarget: number | null;
    callerBlTarget: number | null;
    consumerBlTarget: number | null;
  };
  wrapXrefs: { from: number; to: number }[];
  callsites: Sprintf17Callsite[];
  specCensus: Record<string, number>;
  liveSpecs: string[];
  staticSpecs: string[];
};

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

type Mem = { read8: (a: number) => number; read16: (a: number) => number; read32: (a: number) => number };

function fmtThumb(pc: number, mem: Mem): ThumbLine {
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

function disasmRange(mem: Mem, start: number, end: number): ThumbLine[] {
  const out: ThumbLine[] = [];
  let p = start >>> 0;
  while (p < end) {
    const d = fmtThumb(p, mem);
    out.push(d);
    p = (p + d.size) >>> 0;
  }
  return out;
}

function snapCpu(e: ExtRuntime): Sprintf17Cpu {
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

function cstr(mem: Mem, addr: number, max = 96): { text: string; bytes: number[]; ascii: boolean } {
  const bytes: number[] = [];
  let text = "";
  let ascii = true;
  for (let i = 0; i < max; i++) {
    const b = mem.read8((addr + i) >>> 0) & 0xff;
    bytes.push(b);
    if (b === 0) break;
    if (b < 0x20 || b >= 0x7f) {
      if (b === 0x0a) {
        text += "\n";
        continue;
      }
      ascii = false;
      text += `\\x${b.toString(16).padStart(2, "0")}`;
      continue;
    }
    text += String.fromCharCode(b);
  }
  return { text, bytes, ascii };
}

function parseSpecs(fmt: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < fmt.length; i++) {
    if (fmt.charCodeAt(i) !== 0x25) continue;
    i++;
    if (i >= fmt.length) break;
    if (fmt.charCodeAt(i) === 0x25) {
      out.push("%%");
      continue;
    }
    while (i < fmt.length && "-+ #0".includes(fmt[i]!)) i++;
    if (fmt[i] === "*") i++;
    else while (i < fmt.length && fmt[i]! >= "0" && fmt[i]! <= "9") i++;
    if (fmt[i] === ".") {
      i++;
      if (fmt[i] === "*") i++;
      else while (i < fmt.length && fmt[i]! >= "0" && fmt[i]! <= "9") i++;
    }
    while (i < fmt.length && "hlL".includes(fmt[i]!)) i++;
    if (i < fmt.length) out.push(`%${fmt[i]!}`);
  }
  return out;
}

function ldrPc(pc: number, hw: number): { rd: number; lit: number } | null {
  if ((hw & 0xf800) !== 0x4800) return null;
  const rd = (hw >> 8) & 7;
  const imm8 = hw & 0xff;
  return { rd, lit: ((((pc + 4) & ~3) + imm8 * 4) >>> 0) };
}

function picVa(mem: Mem, ldrAt: number, addAt: number): number {
  const ref = ldrPc(ldrAt, mem.read16(ldrAt));
  if (!ref) return 0;
  const lit = mem.read32(ref.lit) >>> 0;
  return (lit + ((addAt + 4) >>> 0)) >>> 0;
}

function recoverFormat(mem: Mem, blx: number): { format: string; formatVa: number } {
  let addR1 = 0;
  let ldrR1 = 0;
  let addR2 = 0;
  let ldrR2 = 0;
  let subR1c = false;
  for (let off = 2; off <= 0x30; off += 2) {
    const q = (blx - off) >>> 0;
    const hw = mem.read16(q);
    if (hw === 0x4479 && !addR1) addR1 = q;
    if (hw === 0x447a && !addR2) addR2 = q;
    if (hw === 0x390c) subR1c = true;
    const ref = ldrPc(q, hw);
    if (ref?.rd === 1 && !ldrR1) ldrR1 = q;
    if (ref?.rd === 2 && !ldrR2) ldrR2 = q;
  }
  if (addR1 && ldrR1 && ldrR1 < addR1) {
    const va = picVa(mem, ldrR1, addR1);
    return { format: cstr(mem, va).text, formatVa: va };
  }
  if (subR1c && addR2 && ldrR2 && ldrR2 < addR2) {
    const va = (picVa(mem, ldrR2, addR2) - 0x0c) >>> 0;
    return { format: cstr(mem, va).text, formatVa: va };
  }
  return { format: "", formatVa: 0 };
}

function scanGot5cSites(mem: Mem, codeEnd: number, liveBlx: number): Sprintf17Callsite[] {
  const sites: Sprintf17Callsite[] = [];
  let p = EXT_CODE_ADDR;
  while (p + 8 < codeEnd) {
    const hw = mem.read16(p);
    const ref = ldrPc(p, hw);
    if (ref && ref.lit + 4 <= codeEnd && (mem.read32(ref.lit) >>> 0) === SPRINTF17.gotOff) {
      const expectAdd = (0x4400 | (9 << 3) | ref.rd) & 0xffff;
      const expectLdr = (0x6800 | (ref.rd << 3) | ref.rd) & 0xffff;
      const expectBlx = (0x4780 | (ref.rd << 3)) & 0xffff;
      let sawAdd = false;
      let sawLdr = false;
      let blx = 0;
      for (let q = (p + 2) >>> 0; q < p + 0x30 && q < codeEnd; ) {
        const h = mem.read16(q);
        if (h === expectAdd) sawAdd = true;
        if (sawAdd && h === expectLdr) sawLdr = true;
        if (sawLdr && h === expectBlx) {
          blx = q;
          break;
        }
        q = (q + (isThumb32Prefix(h) ? 4 : 2)) >>> 0;
      }
      if (blx) {
        const { format, formatVa } = recoverFormat(mem, blx);
        const specs = parseSpecs(format);
        const varargCount = specs.filter((s) => s !== "%%").length;
        sites.push({
          blx,
          gotLdr: p,
          rd: ref.rd,
          format,
          formatVa,
          specs,
          varargCount,
          stackVarargs: varargCount > 2,
          live: blx === liveBlx,
        });
      }
    }
    p = (p + (isThumb32Prefix(hw) ? 4 : 2)) >>> 0;
  }
  return sites;
}

function scanBlTo(mem: Mem, start: number, end: number, target: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let p = start >>> 0;
  while (p + 3 < end) {
    const hw1 = mem.read16(p);
    if (isThumb32Prefix(hw1)) {
      const hw2 = mem.read16((p + 2) >>> 0);
      decodeThumb32(hw1, hw2, PACK, 0);
      const u = unpackW0(PACK[0]!);
      if (u.op === Op.BL) {
        const to = (p + 4 + (PACK[1]! | 0)) >>> 0;
        if (to === target) out.push({ from: p, to });
      }
      p = (p + 4) >>> 0;
    } else {
      p = (p + 2) >>> 0;
    }
  }
  return out;
}

function census(sites: Sprintf17Callsite[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of sites) {
    for (const sp of s.specs) c[sp] = (c[sp] ?? 0) + 1;
  }
  return c;
}

/**
 * Production-path snapshot at table[17]. Does not register or skip slot 17.
 * Does not write R0/buffer.
 */
export function runSprintf17Forensics(mrp: Uint8Array): Sprintf17Report {
  const productionThrown = runProductionCode0Fault(mrp);
  const cf = extractNamedExt(mrp, "cfunction.ext");
  const codeEnd = (EXT_CODE_ADDR + cf.length) >>> 0;

  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });

  let cpu: Sprintf17Cpu | null = null;
  let p = 0;
  let helper = 0;
  let erRw = 0;
  let handler130 = false;
  let handler38 = false;
  let handler33 = false;
  let handler17 = false;
  let format = "";
  let formatAscii = false;
  let formatBytes: number[] = [];
  let bufferBytes: number[] = [];
  let bufferRegion: Sprintf17Region | null = null;
  let regions: Sprintf17Region[] = [];
  let langPtr = 0;
  let langVal = 0;
  let got17 = 0;
  let got26 = 0;
  let wrap: ThumbLine[] = [];
  let after: ThumbLine[] = [];
  let parent: ThumbLine[] = [];
  let caller: ThumbLine[] = [];
  let consumer: ThumbLine[] = [];
  let wrapHw: number[] = [];
  let afterHw: number[] = [];
  let litGot = 0;
  let litFmt = 0;
  let parentBlTarget: number | null = null;
  let callerBlTarget: number | null = null;
  let consumerBlTarget: number | null = null;
  let wrapXrefs: { from: number; to: number }[] = [];
  let callsites: Sprintf17Callsite[] = [];

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    origBind(ext);
    const e = rt.ext;
    if (!e) return;
    const origD = e.table.dispatch.bind(e.table);
    e.table.dispatch = (c, mem, pc) => {
      const n = tableSlotIndex(pc);
      if (n === SPRINTF17.slot && !cpu) {
        cpu = snapCpu(e);
        p = e.owners.wrapper.p >>> 0;
        helper = e.owners.wrapper.helper >>> 0;
        erRw = c.r[9] >>> 0;
        handler130 = !!e.table.handlers[130];
        handler38 = !!e.table.handlers[38];
        handler33 = !!e.table.handlers[33];
        handler17 = !!e.table.handlers[17];
        const fmt = cstr(mem, c.r[1] >>> 0);
        format = fmt.text;
        formatAscii = fmt.ascii;
        formatBytes = fmt.bytes;
        bufferBytes = [];
        for (let i = 0; i < 16; i++) bufferBytes.push(mem.read8((c.r[0] >>> 0) + i) & 0xff);
        regions = e.mem.regions.map((r) => ({ base: r.base >>> 0, size: r.size >>> 0 }));
        const buf = c.r[0] >>> 0;
        bufferRegion = regions.find((r) => buf >= r.base && buf < r.base + r.size) ?? null;
        langPtr = (erRw + SPRINTF17.langOff) >>> 0;
        langVal = mem.read32(langPtr) >>> 0;
        got17 = mem.read32((erRw + SPRINTF17.gotOff) >>> 0) >>> 0;
        got26 = mem.read32((erRw + SPRINTF17.printfGotOff) >>> 0) >>> 0;
        wrap = disasmRange(mem, SPRINTF17.wrap, SPRINTF17.ret);
        after = disasmRange(mem, SPRINTF17.ret, 0x01e9a8aa);
        parent = disasmRange(mem, SPRINTF17.parent, 0x01e9a91a);
        caller = disasmRange(mem, SPRINTF17.caller, SPRINTF17.callerBl + 8);
        consumer = disasmRange(mem, SPRINTF17.consumer, SPRINTF17.consumer + 0x5c);
        wrapHw = [];
        for (let a = SPRINTF17.wrap; a <= SPRINTF17.blx; a += 2) wrapHw.push(mem.read16(a));
        afterHw = [mem.read16(SPRINTF17.ret), mem.read16(SPRINTF17.ret + 2), mem.read16(SPRINTF17.ret + 4), mem.read16(SPRINTF17.ret + 6)];
        litGot = mem.read32(0x01e9a8c8) >>> 0;
        litFmt = mem.read32(0x01e9a8c4) >>> 0;
        parentBlTarget = parent.find((l) => l.pc === SPRINTF17.parentBl)?.target ?? null;
        callerBlTarget = caller.find((l) => l.pc === SPRINTF17.callerBl)?.target ?? null;
        consumerBlTarget = after.find((l) => l.pc === 0x01e9a88e)?.target ?? null;
        wrapXrefs = scanBlTo(mem, EXT_CODE_ADDR, codeEnd, SPRINTF17.wrap);
        callsites = scanGot5cSites(mem, codeEnd, SPRINTF17.blx);
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

  if (!cpu) throw new Error("table[17] was not reached");

  const specCensus = census(callsites);
  const liveSpecs = [...new Set(callsites.filter((s) => s.live).flatMap((s) => s.specs))];
  const staticSpecs = [...new Set(callsites.filter((s) => !s.live).flatMap((s) => s.specs))];

  return {
    handler130,
    handler38,
    handler33,
    handler17,
    productionThrown,
    probeThrown,
    cpu,
    p,
    helper,
    erRw,
    owner: rt.packName || "wrapper",
    format,
    formatAscii,
    formatBytes,
    bufferBytes,
    bufferRegion,
    regions,
    writableToStackTop: (SPRINTF17.stackTop - SPRINTF17.buffer) | 0,
    langPtr,
    langVal,
    got17,
    got26,
    encodings: {
      wrap,
      after,
      parent,
      caller,
      consumer,
      wrapHw,
      afterHw,
      litGot,
      litFmt,
      parentBlTarget,
      callerBlTarget,
      consumerBlTarget,
    },
    wrapXrefs,
    callsites,
    specCensus,
    liveSpecs,
    staticSpecs,
  };
}

export function renderSprintf17Markdown(r: Sprintf17Report): string {
  const c = r.cpu;
  const sites = r.callsites
    .map(
      (s) =>
        `${s.live ? "LIVE  " : "STATIC"} ${hx(s.blx)}  ${JSON.stringify(s.format)}  specs=${s.specs.join(",") || "—"}  varargs=${s.varargCount}  stack=${s.stackVarargs}`,
    )
    .join("\n");
  return [
    "# table[17] / sprintf_ forensics (Stage 5-C.10F)",
    "",
    "Forensics of the first LIVE table[17] entry. Production implements",
    "literal bytes + `%d` only (5-C.10G). **Stage 5-D NOT STARTED.**",
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
    `fmt   ${hx(c.r[1]!)} ${JSON.stringify(r.format)} ascii=${r.formatAscii}`,
    `buf   ${hx(c.r[0]!)} bytes=${r.bufferBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    `lang  [${hx(r.langPtr)}]=${hx(r.langVal)}  GOT17=${hx(r.got17)} GOT26=${hx(r.got26)}`,
    "```",
    "",
    "## Wrapper 0x01e9a864",
    "",
    "```text",
    ...r.encodings.wrap.map((l) => l.text),
    "```",
    "",
    "## After return 0x01e9a882",
    "",
    "```text",
    ...r.encodings.after.map((l) => l.text),
    "```",
    "",
    "## Parent 0x01e9a8d8",
    "",
    "```text",
    ...r.encodings.parent.map((l) => l.text),
    "```",
    "",
    "## table[17] callsites (ER_RW+0x5c)",
    "",
    "```text",
    sites,
    "```",
    "",
    `- production throw: ${r.productionThrown}`,
    `- probe throw: ${r.probeThrown}`,
    `- handlers 130/38/33/17: ${r.handler130}/${r.handler38}/${r.handler33}/${r.handler17}`,
    `- wrap BL target: ${r.encodings.parentBlTarget === null ? "—" : hx(r.encodings.parentBlTarget)}`,
    `- caller BL target: ${r.encodings.callerBlTarget === null ? "—" : hx(r.encodings.callerBlTarget)}`,
    `- consumer BL target: ${r.encodings.consumerBlTarget === null ? "—" : hx(r.encodings.consumerBlTarget)}`,
    `- GOT literal: ${hx(r.encodings.litGot)}`,
    `- BL → wrap: ${r.wrapXrefs.map((x) => hx(x.from)).join(" ")}`,
    `- callsites: ${r.callsites.length}`,
    `- LIVE specs: ${r.liveSpecs.join(" ") || "—"}`,
    `- STATIC specs: ${r.staticSpecs.join(" ") || "—"}`,
    `- census: ${JSON.stringify(r.specCensus)}`,
    `- writable to stack top: ${r.writableToStackTop}`,
    `- primary window: ${hx(EXT_BASE_ADDR)}+${hx(EXT_MEM_SIZE)}`,
    "",
  ].join("\n");
}
