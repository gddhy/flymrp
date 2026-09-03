import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR, EXT_STOP_ADDR, EXT_TABLE_ADDR, stackTop, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { OP_ADD, OP_MOV, armBlx, armBx, armDpImm, armDpReg, armLdrImm } from "../helpers/asm.ts";
import { buildArmTableCaller, buildThumbTableCaller, wordsToBytes } from "../helpers/ext-asm.ts";
import { hexBytes, unicornExt } from "./ext-oracle.ts";

const CPSR_NZCVT = 0xf8000020;
const MAPS = [
  { addr: 0, size: 0x1_0000 },
  { addr: EXT_TABLE_ADDR, size: 0x1_0000 },
  { addr: 0x0020_0000, size: 0x1_0000 },
  { addr: 0x01e0_0000, size: 0x10_0000 },
];

function regs16(partial: number[], pc: number, sp = stackTop() - 16, lr = EXT_STOP_ADDR): number[] {
  const r = new Array(16).fill(0);
  for (let i = 0; i < partial.length && i < 16; i++) r[i] = partial[i]! >>> 0;
  r[13] = sp >>> 0;
  r[14] = lr >>> 0;
  r[15] = pc >>> 0;
  return r;
}

async function compareExt(opts: {
  bytes: Uint8Array;
  pc: number;
  thumb: number;
  regs?: number[];
  cpsr?: number;
  extra?: { addr: number; bytes: Uint8Array }[];
  dump?: { addr: number; len: number }[];
  table_hooks?: { slot: number; kind: string }[];
  handlers?: Array<{ slot: number; fn: (a: Uint32Array) => number }>;
  until?: number;
}) {
  const rt = new ExtRuntime();
  for (const h of opts.handlers ?? []) rt.registerHandler(h.slot, (_c, _m, a) => h.fn(a));
  rt.pokeCode(opts.pc, opts.bytes);
  for (const e of opts.extra ?? []) rt.mem.load(e.addr, e.bytes);
  const regs = opts.regs ?? regs16([], opts.pc);
  rt.cpu.reset(opts.pc, opts.thumb);
  rt.cpu.loadRegs(regs);
  rt.cpu.r[15] = opts.pc >>> 0;
  rt.cpu.t = opts.thumb;
  rt.cpu.cpsr = opts.cpsr ?? (opts.thumb ? 0x30 : 0x10);
  const js = rt.runGuest(opts.pc | (opts.thumb ? 1 : 0), {
    thumb: opts.thumb,
    r0: regs[0],
    r1: regs[1],
    r2: regs[2],
    r3: regs[3],
    r9: regs[9],
    sp: regs[13],
    lr: regs[14],
  });
  void js;

  const mem = [
    { addr: opts.pc, hex: hexBytes(opts.bytes) },
    ...(opts.extra ?? []).map((e) => ({ addr: e.addr, hex: hexBytes(e.bytes) })),
  ];
  const uni = await unicornExt({
    pc: opts.pc,
    thumb: opts.thumb,
    regs,
    cpsr: opts.cpsr ?? (opts.thumb ? 0x30 : 0x10),
    maps: MAPS,
    mem,
    dump: opts.dump,
    table_hooks: opts.table_hooks,
    until: opts.until ?? EXT_STOP_ADDR,
    count: 256,
  });
  if (uni.error) {
    throw new Error(`unicorn: ${uni.error}`);
  }
  for (let i = 0; i < 15; i++) {
    expect(rt.cpu.r[i] >>> 0, `r${i}`).toBe(uni.regs[i]! >>> 0);
  }
  const jsPc = (rt.cpu.r[15] & ~1) >>> 0;
  const uniPc = (uni.regs[15]! & ~1) >>> 0;
  const stop = 0x0007_fff0;
  if (jsPc === stop && uniPc === stop) {
    /* both finished */
  } else {
    expect(jsPc, "pc").toBe(uniPc);
  }
  expect(rt.cpu.cpsr & CPSR_NZCVT, "cpsr").toBe(uni.cpsr & CPSR_NZCVT);
  for (const d of opts.dump ?? []) {
    const jsHex = hexBytes(rt.mem.slice(d.addr, d.len));
    const u = uni.mem.find((m) => m.addr === d.addr);
    expect(u?.hex, `mem@${d.addr.toString(16)}`).toBe(jsHex);
  }
}

describe("4-J EXT Unicorn differential", () => {
  it("ARM EXT entry vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const bytes = wordsToBytes([armDpImm(OP_MOV, 0, 0, 0, 0x2a), armBx(14)]);
    await compareExt({ bytes, pc: dest, thumb: 0, regs: regs16([0, 1, 2, 3], dest) });
  });

  it("Thumb EXT entry vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const bytes = new Uint8Array([0x05, 0x20, 0x70, 0x47]); // movs r0,#5; bx lr
    await compareExt({
      bytes,
      pc: dest,
      thumb: 1,
      regs: regs16([], dest, stackTop() - 16, EXT_STOP_ADDR | 1),
      cpsr: 0x30,
    });
  });

  it("table call + host return vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const bytes = buildArmTableCaller({ dest, slot: 5, r0: 3, r1: 4 });
    await compareExt({
      bytes,
      pc: dest,
      thumb: 0,
      table_hooks: [{ slot: 5, kind: "add" }],
      handlers: [{ slot: 5, fn: (a) => (a[0] + a[1]) >>> 0 }],
    });
  });

  it("host return Thumb caller vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const bytes = buildThumbTableCaller({ dest, slot: 4, r0: 1, r1: 2 });
    await compareExt({
      bytes,
      pc: dest,
      thumb: 1,
      cpsr: 0x30,
      regs: regs16([], dest, stackTop() - 16, EXT_STOP_ADDR | 1),
      table_hooks: [{ slot: 4, kind: "const" }],
      handlers: [{ slot: 4, fn: () => 0x51 }],
    });
  });

  it("R9 / GOT store vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const rw = 0x0020_0000;
    const bytes = wordsToBytes([armLdrImm(9, 9, 0, 0), armBx(14)]);
    await compareExt({
      bytes,
      pc: dest,
      thumb: 0,
      regs: regs16(Object.assign(new Array(16).fill(0), { 9: rw, 13: stackTop() - 16, 14: EXT_STOP_ADDR, 15: dest }), dest),
      extra: [{ addr: rw, bytes: new Uint8Array(4) }],
      dump: [{ addr: rw, len: 4 }],
    });
  });

  it("output buffer + stack ABI vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const outp = 0x0020_0100;
    const outl = 0x0020_0104;
    const input = 0x0020_0200;
    const sp = (stackTop() - 16) >>> 0;
    const bytes = wordsToBytes([
      armLdrImm(4, 13, 0, 1),
      armLdrImm(5, 13, 4, 1),
      armLdrImm(2, 4, 0, 0),
      armLdrImm(3, 5, 0, 0),
      armBx(14),
    ]);
    const extra = [
      { addr: sp, bytes: wordsToBytes([outp, outl, 0, 0]) },
      { addr: outp, bytes: new Uint8Array(4) },
      { addr: outl, bytes: new Uint8Array(4) },
      { addr: input, bytes: Uint8Array.from([9, 8, 7, 6]) },
    ];
    await compareExt({
      bytes,
      pc: dest,
      thumb: 0,
      regs: regs16([0, 0, input, 4], dest, sp),
      extra,
      dump: [
        { addr: outp, len: 4 },
        { addr: outl, len: 4 },
      ],
    });
  });

  it("nested table call vs Unicorn", async () => {
    const dest = EXT_CODE_ADDR;
    const words = [
      armDpReg(OP_MOV, 0, 0, 6, 14),
      armLdrImm(4, 15, 20),
      armBlx(4),
      (0xe << 28) | (OP_MOV << 21) | (1 << 12) | 0,
      armLdrImm(4, 15, 12),
      armBlx(4),
      (0xe << 28) | (OP_ADD << 21) | (0 << 16) | (0 << 12) | 1,
      armBx(6),
      tableSlotAddr(4),
      tableSlotAddr(5),
    ];
    await compareExt({
      bytes: wordsToBytes(words),
      pc: dest,
      thumb: 0,
      table_hooks: [
        { slot: 4, kind: "const" },
        { slot: 5, kind: "const" },
      ],
      handlers: [
        { slot: 4, fn: () => 0x51 },
        { slot: 5, fn: () => 0x51 },
      ],
    });
  });
});
