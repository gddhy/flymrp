/**
 * Stage 5-C.10J — `_mr_readFile` pack-file ABI forensics (static CFG).
 * Production 5-C.10K implements 40/44/45/41; this probe still records LIVE handlers.
 * Stage 5-D is not started.
 */
import { EXT_CODE_ADDR, tableSlotIndex } from "../abi/layout.ts";
import { ExtRuntime } from "../abi/runtime.ts";
import { isThumb32Prefix } from "../hot/decode-thumb16.ts";
import { decodeThumb32 } from "../hot/decode-thumb32.ts";
import type { GuestMemory } from "../hot/memory.ts";
import { Op, unpackW0 } from "../hot/opcodes.ts";
import { MRPArchive } from "../mrp/archive.ts";
import { MR_FAILED, MR_SEEK_END, MR_SEEK_SET, MR_SEEK_CUR, MR_SUCCESS } from "../mythroad/constants.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { extractNamedExt } from "./code6.ts";
import { runProductionCode0Fault } from "./code0chain.ts";
import { OPEN40 } from "./open40.ts";

const PACK = new Uint32Array(3);

/** Guest `_mr_readFile` and PIC file wrappers in this pack's cfunction.ext. */
export const FILECHAIN = {
  fn: 0x01ea8cdc,
  fnEnd: 0x01ea91c8,
  efsToOpen: 0x01ea8dec,
  openSetup: 0x01ea8e8e,
  openBl: 0x01ea8e92,
  openWrap: 0x01ea89d8,
  afterOpen: 0x01ea8e96,
  memsetBlx: 0x01ea8ea8,
  headerReadBl: 0x01ea8eb0,
  readWrap: 0x01ea8c30,
  cmp16: 0x01ea8eb4,
  cmp232: 0x01ea8ec2,
  magicLe: 1196446285,
  newStyleMin: 232,
  mallocWrap: 0x01ea8918,
  closeWrap: 0x01ea6e18,
  seekWrap: 0x01ea9304,
  indexSeekBl: 0x01ea8f00,
  indexReadBl: 0x01ea8f20,
  freeWrap: 0x01ea7ab4,
  payloadMallocBl: 0x01ea90b8,
  payloadSeekBl: 0x01ea90d0,
  payloadReadInline: 0x01ea90f6,
  successCloseBl: 0x01ea9128,
  infoWrap: 0x01ea7aa8,
  getLenWrap: 0x01ea7b00,
  ferrnoWrap: 0x01ea7a94,
  star: 0x2a,
  dollar: 0x24,
} as const;

/** rxgj mythroad.c `_mr_c_function_table` 39–53. Source inventory, not guessed POSIX order. */
export const FILE_SLOT_INVENTORY = [
  { slot: 39, symbol: "mr_ferrno", signature: "int32 mr_ferrno(void)", purpose: "file errno; rxgj dsm.c always MR_FAILED" },
  { slot: 40, symbol: "asm_mr_open / mr_open", signature: "int32 mr_open(const char *filename, uint32 mode)", purpose: "open file; success = positive handle, failure = 0" },
  { slot: 41, symbol: "asm_mr_close / mr_close", signature: "int32 mr_close(int32 f)", purpose: "close handle; MR_SUCCESS / MR_FAILED" },
  { slot: 42, symbol: "asm_mr_info / mr_info", signature: "int32 mr_info(const char *filename)", purpose: "MR_IS_FILE / MR_IS_DIR / MR_IS_INVALID; not a length API" },
  { slot: 43, symbol: "asm_mr_write / mr_write", signature: "int32 mr_write(int32 f, void *p, uint32 l)", purpose: "write bytes; returns count or MR_FAILED" },
  { slot: 44, symbol: "asm_mr_read / mr_read", signature: "int32 mr_read(int32 f, void *p, uint32 l)", purpose: "read bytes; returns count, 0 at EOF, MR_FAILED on invalid handle" },
  { slot: 45, symbol: "asm_mr_seek / mr_seek", signature: "int32 mr_seek(int32 f, int32 pos, int method)", purpose: "seek; method is MR_SEEK_*; MR_SUCCESS / MR_FAILED" },
  { slot: 46, symbol: "asm_mr_getLen / mr_getLen", signature: "int32 mr_getLen(const char *filename)", purpose: "file length by name; not used by current _mr_readFile EFS path" },
  { slot: 47, symbol: "asm_mr_remove / mr_remove", signature: "int32 mr_remove(const char *filename)", purpose: "delete file" },
  { slot: 48, symbol: "asm_mr_rename / mr_rename", signature: "int32 mr_rename(const char *oldname, const char *newname)", purpose: "rename" },
  { slot: 49, symbol: "asm_mr_mkDir / mr_mkDir", signature: "int32 mr_mkDir(const char *name)", purpose: "mkdir" },
  { slot: 50, symbol: "asm_mr_rmDir / mr_rmDir", signature: "int32 mr_rmDir(const char *name)", purpose: "rmdir" },
  { slot: 51, symbol: "asm_mr_findStart / mr_findStart", signature: "int32 mr_findStart(const char *name, char *buffer, uint32 len)", purpose: "dir search start" },
  { slot: 52, symbol: "asm_mr_findGetNext / mr_findGetNext", signature: "int32 mr_findGetNext(int32 search_handle, char *buffer, uint32 len)", purpose: "dir search next" },
  { slot: 53, symbol: "asm_mr_findStop / mr_findStop", signature: "int32 mr_findStop(int32 search_handle)", purpose: "dir search stop" },
] as const;

export const FILE_SEEK_ORIGINS = {
  MR_SEEK_SET: 0,
  MR_SEEK_CUR: 1,
  MR_SEEK_END: 2,
} as const;

export const MINIMAL_STARTUP_FILE_SLOTS = [40, 44, 45, 41, 43] as const;
export const NOT_REQUIRED_STARTUP_FILE_SLOTS = [39, 46, 47, 48, 50, 51, 52, 53] as const;

export type PicFileWrap = {
  pc: number;
  slot: number;
  rd: number;
  tableOff: number;
};

export type FileBl = {
  from: number;
  to: number;
  slot: number | null;
};

export type FileChainReport = {
  productionThrown: string;
  probeThrown: string;
  lookfor: number | null;
  readFileName: string;
  entryR0: number | null;
  entryR1: number | null;
  entryR2: number | null;
  packName: string;
  packFilenameAt40: string;
  resourceNameAt40: string;
  handlers: Record<number, boolean>;
  wraps: PicFileWrap[];
  bls: FileBl[];
  fileSlotsInFn: number[];
  nextUnimplementedFileSlot: number;
  cmp16: number | null;
  cmp232: number | null;
  efsBranchHw: number;
  inlineReadOff: number;
  archiveBytes: number;
  archiveSameRef: boolean;
  archiveMagic: number;
  fileStart: number;
  listStart: number;
  indexLen: number;
  vfsHasPackName: boolean;
  vfsHasResLang: boolean;
  vfsHasResLangAsPack: boolean;
  design: "SUPPORTED DESIGN / INFERRED COMPATIBLE";
};

export type SpecSeekResult = {
  ret: number;
  pos: number;
};

/** Guest-observable read count. Design spec only — not a production handler. */
export function specReadCount(pos: number, fileLen: number, requested: number): number {
  if (pos < 0 || fileLen < 0 || requested <= 0) return 0;
  const remain = pos >= fileLen ? 0 : fileLen - pos;
  return requested < remain ? requested : remain;
}

/**
 * Guest-observable seek. Follows rxgj `my_seek`/`lseek`, not EXT VFD clamp.
 * Design spec only — not a production handler.
 */
export function specSeek(pos: number, fileLen: number, offset: number, origin: number): SpecSeekResult {
  let next: number;
  if (origin === MR_SEEK_SET) next = offset;
  else if (origin === MR_SEEK_CUR) next = pos + offset;
  else if (origin === MR_SEEK_END) next = fileLen + offset;
  else return { ret: MR_FAILED, pos };
  if (next < 0) return { ret: MR_FAILED, pos };
  return { ret: MR_SUCCESS, pos: next };
}

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

function hw16(mem: { read16(a: number): number }, pc: number): number {
  return mem.read16(pc) & 0xffff;
}

function ldrImm(hw: number): { rd: number; rn: number; imm: number } | null {
  const u = hw & 0xffff;
  if ((u & 0xf800) !== 0x6800) return null;
  return { rd: u & 7, rn: (u >> 3) & 7, imm: ((u >> 6) & 0x1f) * 4 };
}

function cstr(mem: { read8(a: number): number }, addr: number, max = 96): string {
  let text = "";
  for (let i = 0; i < max; i++) {
    const b = mem.read8((addr + i) >>> 0) & 0xff;
    if (b === 0) break;
    text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`;
  }
  return text;
}

/** PIC mr_* wrapper: LDR [pc,#12]; PUSH; ADD pc; LDR #0x38; ADD #0x80; LDR off; BLX; POP. */
export function parsePicFileWrap(mem: { read16(a: number): number }, pc: number): PicFileWrap | null {
  const a = hw16(mem, pc);
  const rd = (a >> 8) & 7;
  if (a !== (0x4800 | (rd << 8) | 3)) return null;
  if (hw16(mem, (pc + 2) >>> 0) !== 0xb580) return null;
  if (hw16(mem, (pc + 4) >>> 0) !== (0x4478 | rd)) return null;
  const ldr38 = 0x6800 | (14 << 6) | (rd << 3) | rd;
  if (hw16(mem, (pc + 6) >>> 0) !== ldr38) return null;
  if (hw16(mem, (pc + 8) >>> 0) !== (0x3000 | (rd << 8) | 0x80)) return null;
  const ldr = ldrImm(hw16(mem, (pc + 10) >>> 0));
  if (!ldr || ldr.rn !== rd) return null;
  const blx = hw16(mem, (pc + 12) >>> 0);
  if ((blx & 0xff87) !== 0x4780) return null;
  if (hw16(mem, (pc + 14) >>> 0) !== 0xbd80) return null;
  return { pc: pc >>> 0, slot: (0x80 + ldr.imm) >>> 2, rd, tableOff: (0x80 + ldr.imm) >>> 0 };
}

export function scanPicFileWraps(mem: { read16(a: number): number }, start: number, end: number): PicFileWrap[] {
  const out: PicFileWrap[] = [];
  let p = start >>> 0;
  const last = (end - 16) >>> 0;
  while (p <= last) {
    const w = parsePicFileWrap(mem, p);
    if (w) out.push(w);
    p = (p + 2) >>> 0;
  }
  return out;
}

function blTarget(pc: number, mem: { read16(a: number): number }): number | null {
  const hw1 = hw16(mem, pc);
  if (!isThumb32Prefix(hw1)) return null;
  decodeThumb32(hw1, hw16(mem, (pc + 2) >>> 0), PACK, 0);
  const u = unpackW0(PACK[0]!);
  if (u.op !== Op.BL) return null;
  return (pc + 4 + (PACK[1]! | 0)) >>> 0;
}

export function scanBls(
  mem: { read16(a: number): number },
  start: number,
  end: number,
  wrapByPc: Map<number, PicFileWrap>,
): FileBl[] {
  const out: FileBl[] = [];
  let p = start >>> 0;
  while (p + 3 < end) {
    const hw1 = hw16(mem, p);
    if (isThumb32Prefix(hw1)) {
      const to = blTarget(p, mem);
      if (to !== null) {
        const w = wrapByPc.get(to);
        out.push({ from: p, to, slot: w?.slot ?? null });
      }
      p = (p + 4) >>> 0;
    } else {
      p = (p + 2) >>> 0;
    }
  }
  return out;
}

function cmpImm8(mem: GuestMemory, pc: number): number | null {
  const hw = hw16(mem, pc);
  if ((hw & 0xff00) !== 0x2800) return null;
  return hw & 0xff;
}

function snapshotHandlers(table: { handlers: Array<unknown> }): Record<number, boolean> {
  const handlers: Record<number, boolean> = {};
  for (const s of [0, 1, 3, 10, 14, ...FILE_SLOT_INVENTORY.map((x) => x.slot)]) {
    handlers[s] = !!table.handlers[s];
  }
  return handlers;
}

export function runFileChainForensics(mrp: Uint8Array): FileChainReport {
  const productionThrown = runProductionCode0Fault(mrp);
  const cf = extractNamedExt(mrp, "cfunction.ext");
  const codeEnd = (EXT_CODE_ADDR + cf.length) >>> 0;
  const scanRt = new ExtRuntime();
  scanRt.mem.load(EXT_CODE_ADDR, cf);
  const mem = scanRt.mem;
  const wraps = scanPicFileWraps(mem, EXT_CODE_ADDR, codeEnd).filter((w) => w.slot >= 39 && w.slot <= 53);
  const wrapByPc = new Map(wraps.map((w) => [w.pc, w]));
  wrapByPc.set(FILECHAIN.mallocWrap, { pc: FILECHAIN.mallocWrap, slot: 0, rd: 0, tableOff: 0 });
  wrapByPc.set(FILECHAIN.freeWrap, { pc: FILECHAIN.freeWrap, slot: 1, rd: 0, tableOff: 4 });
  const bls = scanBls(mem, FILECHAIN.fn, FILECHAIN.fnEnd, wrapByPc);
  const fileSlotsInFn = [...new Set(bls.map((b) => b.slot).filter((s): s is number => s !== null && s >= 39 && s <= 53))].sort(
    (a, b) => a - b,
  );

  let lookfor: number | null = null;
  let readFileName = "";
  let entryR0: number | null = null;
  let entryR1: number | null = null;
  let entryR2: number | null = null;
  let packFilenameAt40 = "";
  let resourceNameAt40 = "";
  let probeThrown = "";
  let handlers: Record<number, boolean> = {};

  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });
  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (e) => {
    origBind(e);
    const extRt = rt.ext;
    if (!extRt) return;
    const prevFetch = extRt.cpu.onBeforeFetch;
    extRt.cpu.onBeforeFetch = (c) => {
      const pc = (c.r[15] >>> 0) & ~1;
      if (pc === FILECHAIN.fn && entryR0 === null) {
        entryR0 = c.r[0] >>> 0;
        entryR1 = c.r[1] >>> 0;
        entryR2 = c.r[2] >>> 0;
        readFileName = cstr(extRt.mem, c.r[1] >>> 0);
        lookfor = extRt.mem.read32(c.r[13] >>> 0) | 0;
      }
      return prevFetch ? prevFetch(c) : false;
    };
    const origD = extRt.table.dispatch.bind(extRt.table);
    extRt.table.dispatch = (cpu, guestMem, pc) => {
      const n = tableSlotIndex(pc);
      if (n === OPEN40.slot && !packFilenameAt40) {
        packFilenameAt40 = cstr(guestMem, cpu.r[0] >>> 0);
        resourceNameAt40 = cstr(guestMem, cpu.r[6] >>> 0);
        handlers = snapshotHandlers(extRt.table);
      }
      origD(cpu, guestMem, pc);
    };
  };

  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
  } catch (err) {
    probeThrown = err instanceof Error ? err.message : String(err);
  }

  const archive = rt.mrp ?? MRPArchive.parse(mrp);
  const packName = rt.packName || archive.header.filename;
  const inlineLdr = ldrImm(hw16(mem, FILECHAIN.payloadReadInline + 2));

  return {
    productionThrown,
    probeThrown,
    lookfor,
    readFileName,
    entryR0,
    entryR1,
    entryR2,
    packName,
    packFilenameAt40,
    resourceNameAt40,
    handlers,
    wraps,
    bls,
    fileSlotsInFn,
    nextUnimplementedFileSlot: 44,
    cmp16: cmpImm8(mem, FILECHAIN.cmp16),
    cmp232: cmpImm8(mem, FILECHAIN.cmp232),
    efsBranchHw: hw16(mem, FILECHAIN.efsToOpen),
    inlineReadOff: inlineLdr?.imm ?? -1,
    archiveBytes: archive.data.length,
    archiveSameRef: archive.data === mrp,
    archiveMagic: archive.data[0]! | (archive.data[1]! << 8) | (archive.data[2]! << 16) | (archive.data[3]! << 24),
    fileStart: archive.header.fileStart,
    listStart: archive.header.listStart,
    indexLen: archive.header.fileStart + 8 - archive.header.listStart,
    vfsHasPackName: rt.vfs.exists(packName),
    vfsHasResLang: rt.vfs.exists(OPEN40.sprintfText),
    vfsHasResLangAsPack: packName === OPEN40.sprintfText,
    design: "SUPPORTED DESIGN / INFERRED COMPATIBLE",
  };
}

export function renderFileChainMarkdown(r: FileChainReport): string {
  const inv = FILE_SLOT_INVENTORY.map((s) => `${s.slot}\t${s.symbol}\t${s.signature}`).join("\n");
  const wraps = r.wraps.map((w) => `${hx(w.pc)} slot=${w.slot} off=${hx(w.tableOff)}`).join("\n");
  const bls = r.bls
    .filter((b) => b.slot !== null)
    .map((b) => `${hx(b.from)} → ${hx(b.to)} slot=${b.slot}`)
    .join("\n");
  const impl = Object.entries(r.handlers)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([s, v]) => `${s}:${v ? "yes" : "no"}`)
    .join(" ");
  return [
    "# Stage 5-C.10J file-chain forensics",
    "",
    "Read-only. No table[40]/41+ handlers. No fake handles.",
    "",
    "## inventory (rxgj FULL mythroad.c)",
    "",
    "```text",
    inv,
    "```",
    "",
    "## PIC file wrappers 39–53",
    "",
    "```text",
    wraps || "—",
    "```",
    "",
    "## `_mr_readFile` BLs with known slot",
    "",
    "```text",
    bls || "—",
    "```",
    "",
    `- production throw: ${r.productionThrown}`,
    `- probe throw: ${r.probeThrown}`,
    `- lookfor at _mr_readFile [sp]: ${r.lookfor}`,
    `- _mr_readFile r0/r1/r2: ${r.entryR0 === null ? "—" : hx(r.entryR0)} ${r.entryR1 === null ? "—" : hx(r.entryR1)} ${r.entryR2 === null ? "—" : hx(r.entryR2)}`,
    `- _mr_readFile r1 filename: ${JSON.stringify(r.readFileName)}`,
    `- table40 filename: ${JSON.stringify(r.packFilenameAt40)}`,
    `- table40 R6 resource: ${JSON.stringify(r.resourceNameAt40)}`,
    `- packName: ${JSON.stringify(r.packName)}`,
    `- file slots in fn: ${r.fileSlotsInFn.join(", ")}`,
    `- next unimplemented file slot: ${r.nextUnimplementedFileSlot}`,
    `- archive bytes: ${r.archiveBytes} sameRef=${r.archiveSameRef} magic=${r.archiveMagic} fileStart=${r.fileStart} listStart=${r.listStart} indexLen=${r.indexLen}`,
    `- vfs has packName: ${r.vfsHasPackName} res_lang0.rc: ${r.vfsHasResLang} pack==resource: ${r.vfsHasResLangAsPack}`,
    `- handlers: ${impl}`,
    `- design: ${r.design}`,
    `- cmp16: ${r.cmp16} cmp232: ${r.cmp232} efsBranch: ${hx(r.efsBranchHw)} inlineReadOff: ${r.inlineReadOff}`,
    "",
    "Stage 5-D: NOT STARTED.",
    "",
  ].join("\n");
}
