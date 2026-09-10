import { AEX_P_ER_RW_OFF, EXT_CODE_ADDR, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { TESTCOM130_DEP } from "./testcom130dep.ts";

/** Live / static addresses from this pack's cfunction.ext. Not an implementation. */
export const CODE0_CHAIN = {
  helperResume: TESTCOM130_DEP.helperResume,
  init1: TESTCOM130_DEP.nextInit,
  init2: TESTCOM130_DEP.nextInit2,
  helperEpilogue: TESTCOM130_DEP.helperEpilogue,
  memsetFn: 0x01eab1ac,
  memsetBlx: 0x01eab1cc,
  memsetLitOff: 0x01eab1d4,
  platExFn: 0x01ea664c,
  platExBlx: 0x01ea666a,
  platExLit: 0x01ea6684,
  nextAfterPlat: 0x01ea7ce8,
  slot14: 14,
  slot38: 38,
  slot38Stub: 0x00010098,
  platExCode: 0x4c6,
  memsetLen: 0x78,
  erRwFpOff: 0x50,
  memsetDestOff: 0x1940,
} as const;

export type Code0TableHit = {
  slot: number;
  r0: number;
  r1: number;
  r2: number;
  r3: number;
  r9: number;
  lr: number;
  sp: number;
  pc: number;
  stack0: number;
  stack4: number;
};

export type Code0ChainReport = {
  handler130: boolean;
  handler38: boolean;
  productionThrown: string;
  probeThrown: string;
  skipped130With: number;
  code0Slots: number[];
  hits: Code0TableHit[];
  extWord0: number;
  erRw: number;
  erRw50: number;
  memsetDest: number;
  init2Reached: boolean;
  encodings: {
    init1Push: number;
    init1Mov0: number;
    memsetLit: number;
    platExLit: number;
    platExBlx: number;
    init2Push: number;
    init2Blx: number;
    init2Pop: number;
  };
};

function snapHit(e: ExtRuntime, n: number, pc: number): Code0TableHit {
  const cpu = e.cpu;
  const sp = cpu.r[13] >>> 0;
  return {
    slot: n,
    r0: cpu.r[0] >>> 0,
    r1: cpu.r[1] >>> 0,
    r2: cpu.r[2] >>> 0,
    r3: cpu.r[3] >>> 0,
    r9: cpu.r[9] >>> 0,
    lr: cpu.r[14] >>> 0,
    sp,
    pc: pc >>> 0,
    stack0: e.mem.read32(sp) >>> 0,
    stack4: e.mem.read32((sp + 4) >>> 0) >>> 0,
  };
}

/**
 * Production start: first unknown slot after table[130] case 7.
 */
export function runProductionCode0Fault(mrp: Uint8Array): string {
  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });
  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Stage 5-C.8 forensics.
 * table[130] case 7 and table[38] code 0x4c6 now run for real. Does not register or skip table[33].
 */
export function runCode0ChainForensics(mrp: Uint8Array): Code0ChainReport {
  const productionThrown = runProductionCode0Fault(mrp);
  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });

  const hits: Code0TableHit[] = [];
  const code0Slots: number[] = [];
  let watching0 = false;
  let reached130 = false;
  let init2Reached = false;
  let extWord0 = 0;
  let erRw = 0;
  let erRw50 = 0;
  let memsetDest = 0;
  let handler130 = false;
  let handler38 = false;
  const encodings = {
    init1Push: 0,
    init1Mov0: 0,
    memsetLit: 0,
    platExLit: 0,
    platExBlx: 0,
    init2Push: 0,
    init2Blx: 0,
    init2Pop: 0,
  };

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    origBind(ext);
    const e = rt.ext;
    if (!e) return;

    const prev = e.cpu.onBeforeFetch;
    e.cpu.onBeforeFetch = (cpu) => {
      if (watching0 && (cpu.r[15] >>> 0) === CODE0_CHAIN.init2) init2Reached = true;
      return prev ? prev(cpu) : false;
    };

    const origCall = e.arm_ext_call.bind(e);
    e.arm_ext_call = (code, input, inputAddr, inputLen) => {
      if (code === 0) {
        watching0 = true;
        extWord0 = e.mem.read32(EXT_CODE_ADDR) >>> 0;
        encodings.init1Push = e.mem.read16(CODE0_CHAIN.init1);
        encodings.init1Mov0 = e.mem.read16(CODE0_CHAIN.init1 + 8);
        encodings.memsetLit = e.mem.read32(CODE0_CHAIN.memsetLitOff) >>> 0;
        encodings.platExLit = e.mem.read32(CODE0_CHAIN.platExLit) >>> 0;
        encodings.platExBlx = e.mem.read16(CODE0_CHAIN.platExBlx);
        encodings.init2Push = e.mem.read16(CODE0_CHAIN.init2);
        encodings.init2Blx = e.mem.read16(0x01ea929a);
        encodings.init2Pop = e.mem.read16(0x01ea92a0);
      }
      try {
        return origCall(code, input, inputAddr, inputLen);
      } finally {
        if (code === 0) watching0 = false;
      }
    };

    const origD = e.table.dispatch.bind(e.table);
    e.table.dispatch = (cpu, mem, pc) => {
      const n = tableSlotIndex(pc);
      if (watching0) {
        code0Slots.push(n);
        const hit = snapHit(e, n, pc);
        hits.push(hit);
        if (n === CODE0_CHAIN.slot14) memsetDest = hit.r0;
        if (n === CODE0_CHAIN.slot38) {
          erRw = e.owners.wrapper.p ? e.mem.read32(e.owners.wrapper.p + AEX_P_ER_RW_OFF) >>> 0 : 0;
          erRw50 = e.mem.read32((cpu.r[9] >>> 0) + CODE0_CHAIN.erRwFpOff) >>> 0;
          handler130 = !!e.table.handlers[130];
          handler38 = !!e.table.handlers[38];
        }
      }
      if (n === 130 && watching0) reached130 = true;
      origD(cpu, mem, pc);
    };
  };

  let probeThrown = "";
  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
  } catch (err) {
    probeThrown = err instanceof Error ? err.message : String(err);
  }

  if (!reached130) throw new Error("table[130] was not reached");
  if (!hits.some((h) => h.slot === CODE0_CHAIN.slot38)) throw new Error("table[38] was not reached");

  return {
    handler130,
    handler38,
    productionThrown,
    probeThrown,
    skipped130With: 0,
    code0Slots,
    hits,
    extWord0,
    erRw,
    erRw50,
    memsetDest,
    init2Reached,
    encodings,
  };
}

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

export function renderCode0ChainMarkdown(r: Code0ChainReport): string {
  const h14 = r.hits.find((h) => h.slot === 14);
  const h38 = r.hits.find((h) => h.slot === 38);
  return [
    "# code-0 init chain after table[130] (Stage 5-C.8)",
    "",
    "Forensics. table[130] case 7 and table[38] code 0x4c6 are implemented (rxgj FULL). **table[33] is not. Stage 5-D NOT STARTED.**",
    "",
    "Production throws the first unknown slot after 38. This probe does **not** cbRet slot 33.",
    "",
    "## Live table hits (code 0)",
    "",
    "```text",
    ...r.hits.map(
      (h) =>
        `slot ${h.slot}  pc=${hx(h.pc)}  r0=${hx(h.r0)} r1=${hx(h.r1)} r2=${hx(h.r2)} r3=${hx(h.r3)}  r9=${hx(h.r9)} lr=${hx(h.lr)} [sp]=${hx(h.stack0)} [sp+4]=${hx(h.stack4)}`,
    ),
    "```",
    "",
    `- production throw: ${r.productionThrown}`,
    `- probe throw: ${r.probeThrown}`,
    `- handlers 130/38: ${r.handler130}/${r.handler38}`,
    `- EXT+0: ${hx(r.extWord0)} (mr_table base)`,
    `- [r9,#0x50]: ${hx(r.erRw50)}`,
    `- memset dest: ${hx(r.memsetDest)} (= ER_RW+${hx(CODE0_CHAIN.memsetDestOff)})`,
    `- 0x01ea9254 reached: ${r.init2Reached}`,
    h14
      ? `- slot 14: memset2(${hx(h14.r0)}, ${hx(h14.r1)}, ${hx(h14.r2)}) via [r9,#0x50]`
      : "",
    h38
      ? `- slot 38: platEx code=${hx(h38.r0)} input=${hx(h38.r1)} inlen=${hx(h38.r2)} outputp=${hx(h38.r3)} outlenp=${hx(h38.stack0)} cb=${hx(h38.stack4)}`
      : "",
    "",
  ]
    .filter((s) => s !== "")
    .join("\n");
}
