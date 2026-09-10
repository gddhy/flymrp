import { AEX_P_ER_RW_OFF, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";

/** Live addresses from this pack's cfunction.ext (gssjxz). Not rxgj sample .s. */
export const TESTCOM130 = {
  slot: 130,
  stubPc: 0x00010208,
  helper: 0x01ea5e9d,
  helperThumbPc: 0x01ea5e9c,
  helperBl: 0x01ea5ece,
  func: 0x01e9ceec,
  r5Load: 0x01e9cf0a,
  r1Mov: 0x01e9cf5a,
  r2Add: 0x01e9cf5c,
  r0Mov: 0x01e9cf5e,
  blx: 0x01e9cf60,
  cmp: 0x01e9cf62,
  bne: 0x01e9cf64,
  sub2: 0x01e9cf66,
  str: 0x01e9cf68,
  pop: 0x01e9cf6a,
  literal: 0x01e9cf78,
  enc: {
    r5Load: 0x4d1b,
    r1Mov: 0x2107,
    r2Add: 0x1c2a,
    r0Mov: 0x2000,
    blxR3: 0x4798,
    cmpR0R5: 0x42a8,
    bne: 0xd101,
    sub2: 0x3802,
    strR4_18: 0x61a0,
  },
} as const;

export type TestCom130Cpu = {
  r: number[];
  pc: number;
  lr: number;
  sp: number;
  r9: number;
  cpsr: number;
  tBit: number;
};

export type TestCom130Report = {
  cpu: TestCom130Cpu;
  p: number;
  helper: number;
  erRw: number;
  erRwPlus1c: number;
  r4: number;
  r5: number;
  code0Slots: number[];
  funcEntry: { pc: number; lr: number };
  helperBlTarget: number;
  encodings: {
    r5Load: number;
    r1Mov: number;
    r2Add: number;
    r0Mov: number;
    blx: number;
    cmp: number;
    bne: number;
    sub2: number;
    str: number;
    literal: number;
  };
  handlerPresent: boolean;
  thrown: string;
};

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

function snapCpu(e: ExtRuntime): TestCom130Cpu {
  const r = [...e.cpu.r].map((v) => v >>> 0);
  return {
    r,
    pc: r[15]!,
    lr: r[14]!,
    sp: r[13]!,
    r9: r[9]!,
    cpsr: e.cpu.cpsr >>> 0,
    tBit: e.cpu.t & 1,
  };
}

/**
 * Read-only table[130] / asm_mr_TestCom call-site forensics.
 * Handler is case 7 only. Snapshot is at BLX entry.
 */
export function runTestCom130Forensics(mrp: Uint8Array): TestCom130Report {
  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });

  let cpu: TestCom130Cpu | null = null;
  let p = 0;
  let helper = 0;
  let erRw = 0;
  let erRwPlus1c = 0;
  let r4 = 0;
  let r5 = 0;
  let handlerPresent = false;
  const code0Slots: number[] = [];
  let watching0 = false;
  let funcEntry: { pc: number; lr: number } | null = null;
  const encodings = {
    r5Load: 0,
    r1Mov: 0,
    r2Add: 0,
    r0Mov: 0,
    blx: 0,
    cmp: 0,
    bne: 0,
    sub2: 0,
    str: 0,
    literal: 0,
  };

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    origBind(ext);
    const e = rt.ext;
    if (!e) return;

    const prev = e.cpu.onBeforeFetch;
    e.cpu.onBeforeFetch = (c) => {
      if (watching0 && (c.r[15] >>> 0) === TESTCOM130.func) {
        funcEntry = { pc: c.r[15] >>> 0, lr: c.r[14] >>> 0 };
      }
      return prev ? prev(c) : false;
    };

    const origCall = e.arm_ext_call.bind(e);
    e.arm_ext_call = (code, input, inputAddr, inputLen) => {
      if (code === 0) watching0 = true;
      try {
        return origCall(code, input, inputAddr, inputLen);
      } finally {
        if (code === 0) watching0 = false;
      }
    };

    const origD = e.table.dispatch.bind(e.table);
    e.table.dispatch = (c, mem, pc) => {
      const n = tableSlotIndex(pc);
      if (watching0) code0Slots.push(n);
      if (n === TESTCOM130.slot) {
        cpu = snapCpu(e);
        p = e.owners.wrapper.p >>> 0;
        helper = e.owners.wrapper.helper >>> 0;
        erRw = p ? e.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0 : 0;
        erRwPlus1c = erRw ? e.mem.read32(erRw + 0x1c) >>> 0 : 0;
        r4 = c.r[4] >>> 0;
        r5 = c.r[5] >>> 0;
        handlerPresent = !!e.table.handlers[TESTCOM130.slot];
        encodings.r5Load = e.mem.read16(TESTCOM130.r5Load);
        encodings.r1Mov = e.mem.read16(TESTCOM130.r1Mov);
        encodings.r2Add = e.mem.read16(TESTCOM130.r2Add);
        encodings.r0Mov = e.mem.read16(TESTCOM130.r0Mov);
        encodings.blx = e.mem.read16(TESTCOM130.blx);
        encodings.cmp = e.mem.read16(TESTCOM130.cmp);
        encodings.bne = e.mem.read16(TESTCOM130.bne);
        encodings.sub2 = e.mem.read16(TESTCOM130.sub2);
        encodings.str = e.mem.read16(TESTCOM130.str);
        encodings.literal = e.mem.read32(TESTCOM130.literal) >>> 0;
      }
      origD(c, mem, pc);
    };
  };

  let thrown = "";
  try {
    rt.loadMrp(mrp);
    rt.start("start.mr");
  } catch (err) {
    thrown = err instanceof Error ? err.message : String(err);
  }

  if (!cpu) throw new Error("table[130] was not reached");

  return {
    cpu,
    p,
    helper,
    erRw,
    erRwPlus1c,
    r4,
    r5,
    code0Slots,
    funcEntry: funcEntry ?? { pc: 0, lr: 0 },
    helperBlTarget: TESTCOM130.func,
    encodings,
    handlerPresent,
    thrown,
  };
}

export function renderTestCom130Markdown(r: TestCom130Report): string {
  const c = r.cpu;
  return [
    "# table[130] / asm_mr_TestCom forensics (Stage 5-C.6)",
    "",
    "Forensics only. **table[130] is not implemented. Stage 5-D NOT STARTED.**",
    "",
    "## CPU at stub",
    "",
    "```text",
    `PC    ${hx(c.pc)}`,
    `LR    ${hx(c.lr)}`,
    `SP    ${hx(c.sp)}`,
    `R0-R3 ${[c.r[0], c.r[1], c.r[2], c.r[3]].map(hx).join(" ")}`,
    `R4-R8 ${c.r.slice(4, 9).map(hx).join(" ")}`,
    `R9    ${hx(c.r9)}`,
    `R10-R12 ${c.r.slice(10, 13).map(hx).join(" ")}`,
    `CPSR  ${hx(c.cpsr)}  T=${c.tBit}`,
    `P     ${hx(r.p)}  helper=${hx(r.helper)}  ER_RW=${hx(r.erRw)}`,
    `R4    ${hx(r.r4)} (= ER_RW+4)  R5=${hx(r.r5)}`,
    `ER_RW+0x1c ${hx(r.erRwPlus1c)}  (still 0; TestCom did not write)`,
    "```",
    "",
    "## Guest call chain",
    "",
    "```text",
    `helper ${hx(TESTCOM130.helperThumbPc)}`,
    `  BL ${hx(TESTCOM130.helperBl)} → ${hx(TESTCOM130.func)}`,
    `    movs r1, #7          @ ${hx(TESTCOM130.r1Mov)}`,
    `    adds r2, r5, #0      @ ${hx(TESTCOM130.r2Add)}  ; r5 = [ ${hx(TESTCOM130.literal)} ] = 0x270f`,
    `    movs r0, #0          @ ${hx(TESTCOM130.r0Mov)}`,
    `    blx  r3              @ ${hx(TESTCOM130.blx)} → table[130]`,
    "```",
    "",
    `- code 0 slots before/at fault: ${r.code0Slots.join(", ")}`,
    `- handler present: ${r.handlerPresent}`,
    `- throw: ${r.thrown}`,
    "",
  ].join("\n");
}

