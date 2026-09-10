import { EXT_CODE_ADDR, tableSlotIndex } from "../abi/layout.ts";
import type { ExtRuntime } from "../abi/runtime.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../mythroad/index.ts";
import { extractNamedExt } from "./code6.ts";
import { CODE0_CHAIN, runProductionCode0Fault } from "./code0chain.ts";

/** Pack-local addresses. Forensics only — not an implementation. */
export const PLATEX38 = {
  slot: 38,
  stub: 0x00010098,
  wrap: 0x01ea664c,
  bne: 0x01ea665e,
  pathALitLoad: 0x01ea6668,
  pathABlx: 0x01ea666a,
  addSp: 0x01ea666c,
  pop: 0x01ea666e,
  pathBBlx: 0x01ea667a,
  pathBBack: 0x01ea667c,
  lit4c6: 0x01ea6684,
  lit4c7: 0x01ea6688,
  callerMov0: 0x01ea7f70,
  callerBl: 0x01ea7f72,
  callerNext: 0x01ea7f76,
  slot33Fn: 0x01ea7ce8,
  slot33Blx: 0x01ea7cf4,
  slot33Stub: 0x00010084,
  init2: CODE0_CHAIN.init2,
  codeA: 0x4c6,
  codeB: 0x4c7,
  enc: {
    bne: 0xd107,
    pathALitLoad: 0x4806,
    pathABlx: 0x47a0,
    addSp: 0xb002,
    pop: 0xbd10,
    pathBBlx: 0x47a0,
    callerMov0: 0x2000,
    slot33Blx: 0x4780,
  },
} as const;

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

export type Platex38Hit = {
  r0: number;
  r1: number;
  r2: number;
  r3: number;
  r9: number;
  lr: number;
  sp: number;
  spAlign8: boolean;
  stack0: number;
  stack4: number;
  stack8: number;
  stack12: number;
};

export type Platex38Callsite = {
  blx: number;
  codeLit: number | null;
  onInitCfg: boolean;
};

export type Platex38Report = {
  handler130: boolean;
  handler38: boolean;
  handler33: boolean;
  productionThrown: string;
  probeThrown: string;
  skipped130With: number;
  hit: Platex38Hit;
  encodings: {
    bne: number;
    pathALitLoad: number;
    pathABlx: number;
    addSp: number;
    pop: number;
    pathBBlx: number;
    callerMov0: number;
    callerNextHw1: number;
    slot33Blx: number;
    lit4c6: number;
    lit4c7: number;
  };
  literals4c6: number[];
  literals4c7: number[];
  callsites: Platex38Callsite[];
  nextBlAfter38: number;
  slot33Blx: number;
  init2Reached: boolean;
};

function snap38(e: ExtRuntime): Platex38Hit {
  const cpu = e.cpu;
  const sp = cpu.r[13] >>> 0;
  return {
    r0: cpu.r[0] >>> 0,
    r1: cpu.r[1] >>> 0,
    r2: cpu.r[2] >>> 0,
    r3: cpu.r[3] >>> 0,
    r9: cpu.r[9] >>> 0,
    lr: cpu.r[14] >>> 0,
    sp,
    spAlign8: (sp & 7) === 0,
    stack0: e.mem.read32(sp) >>> 0,
    stack4: e.mem.read32((sp + 4) >>> 0) >>> 0,
    stack8: e.mem.read32((sp + 8) >>> 0) >>> 0,
    stack12: e.mem.read32((sp + 12) >>> 0) >>> 0,
  };
}

/**
 * Stage 5-C.9 forensics.
 * table[130] case 7 and table[38] code 0x4c6 run for real. Does not register or skip table[33].
 */
export function runPlatex38Forensics(mrp: Uint8Array): Platex38Report {
  const productionThrown = runProductionCode0Fault(mrp);
  const cf = extractNamedExt(mrp, "cfunction.ext");
  const literals4c6 = findLe32(cf, PLATEX38.codeA);
  const literals4c7 = findLe32(cf, PLATEX38.codeB);
  const rt = new MythroadRuntime({
    graphics: new NullGraphicsBackend(),
    trace: new RuntimeTrace(),
    abiMode: "strict",
  });

  let watching0 = false;
  let reached130 = false;
  let init2Reached = false;
  let hit: Platex38Hit | null = null;
  let handler130 = false;
  let handler38 = false;
  let handler33 = false;
  const encodings = {
    bne: 0,
    pathALitLoad: 0,
    pathABlx: 0,
    addSp: 0,
    pop: 0,
    pathBBlx: 0,
    callerMov0: 0,
    callerNextHw1: 0,
    slot33Blx: 0,
    lit4c6: 0,
    lit4c7: 0,
  };

  const origBind = rt.bindExt.bind(rt);
  rt.bindExt = (ext) => {
    origBind(ext);
    const e = rt.ext;
    if (!e) return;

    const prev = e.cpu.onBeforeFetch;
    e.cpu.onBeforeFetch = (cpu) => {
      if (watching0 && (cpu.r[15] >>> 0) === PLATEX38.init2) init2Reached = true;
      return prev ? prev(cpu) : false;
    };

    const origCall = e.arm_ext_call.bind(e);
    e.arm_ext_call = (code, input, inputAddr, inputLen) => {
      if (code === 0) {
        watching0 = true;
        encodings.bne = e.mem.read16(PLATEX38.bne);
        encodings.pathALitLoad = e.mem.read16(PLATEX38.pathALitLoad);
        encodings.pathABlx = e.mem.read16(PLATEX38.pathABlx);
        encodings.addSp = e.mem.read16(PLATEX38.addSp);
        encodings.pop = e.mem.read16(PLATEX38.pop);
        encodings.pathBBlx = e.mem.read16(PLATEX38.pathBBlx);
        encodings.callerMov0 = e.mem.read16(PLATEX38.callerMov0);
        encodings.callerNextHw1 = e.mem.read16(PLATEX38.callerNext);
        encodings.slot33Blx = e.mem.read16(PLATEX38.slot33Blx);
        encodings.lit4c6 = e.mem.read32(PLATEX38.lit4c6) >>> 0;
        encodings.lit4c7 = e.mem.read32(PLATEX38.lit4c7) >>> 0;
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
      if (n === 130 && watching0) reached130 = true;
      if (n === PLATEX38.slot && watching0 && !hit) {
        hit = snap38(e);
        handler130 = !!e.table.handlers[130];
        handler38 = !!e.table.handlers[38];
        handler33 = !!e.table.handlers[33];
      }
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
  if (!hit) throw new Error("table[38] was not reached");

  return {
    handler130,
    handler38,
    handler33,
    productionThrown,
    probeThrown,
    skipped130With: 0,
    hit,
    encodings,
    literals4c6,
    literals4c7,
    callsites: [
      { blx: PLATEX38.pathABlx, codeLit: PLATEX38.codeA, onInitCfg: true },
      { blx: PLATEX38.pathBBlx, codeLit: PLATEX38.codeB, onInitCfg: false },
      { blx: 0x01ea6934, codeLit: 0x4b4, onInitCfg: false },
      { blx: 0x01ea617a, codeLit: 0x4b4, onInitCfg: false },
    ],
    nextBlAfter38: PLATEX38.slot33Fn,
    slot33Blx: PLATEX38.slot33Blx,
    init2Reached,
  };
}

function hx(n: number): string {
  return `0x${(n >>> 0).toString(16)}`;
}

export function renderPlatex38Markdown(r: Platex38Report): string {
  const h = r.hit;
  return [
    "# table[38] / asm_mr_platEx forensics (Stage 5-C.9)",
    "",
    "Forensics. table[130] case 7 and table[38] code 0x4c6 are implemented (rxgj FULL). **table[33] is not. Stage 5-D NOT STARTED.**",
    "",
    "Production throws the first unknown slot after 38. This probe does **not** cbRet slot 33.",
    "It does **not** skip 33.",
    "",
    "## Live ABI at stub",
    "",
    "```text",
    `slot 38`,
    `identity: CONFIRMED  asm_mr_platEx = mr_platEx  (no _mr_platEx symbol)`,
    `C signature: int32 mr_platEx(int32 code, uint8 *input, int32 input_len, uint8 **output, int32 *output_len, MR_PLAT_EX_CB *cb)`,
    `R0: ${hx(h.r0)}`,
    `R1: ${hx(h.r1)}`,
    `R2: ${hx(h.r2)}`,
    `R3: ${hx(h.r3)}`,
    `stack args: [sp+0]=${hx(h.stack0)} [sp+4]=${hx(h.stack4)}  (output_len, cb)`,
    `not args:   [sp+8]=${hx(h.stack8)} [sp+12]=${hx(h.stack12)}  (saved r4, saved lr)`,
    `SP: ${hx(h.sp)} align8=${h.spAlign8}`,
    `return consumer: none (pop {r4,pc}; next BL overwrites r0)`,
    "```",
    "",
    `- production throw: ${r.productionThrown}`,
    `- probe throw: ${r.probeThrown}`,
    `- handlers 130/38/33: ${r.handler130}/${r.handler38}/${r.handler33}`,
    `- 0x4c6 literals: ${r.literals4c6.map(hx).join(" ")}`,
    `- 0x4c7 literals: ${r.literals4c7.map(hx).join(" ")}`,
    `- next BL after 38 wrap: ${hx(r.nextBlAfter38)}`,
    `- 0x01ea9254 reached: ${r.init2Reached}`,
    "",
  ].join("\n");
}
