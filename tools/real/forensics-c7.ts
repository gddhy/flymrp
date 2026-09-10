#!/usr/bin/env npx tsx
/**
 * Stage 5-C.7 read-only scan. Does not register table[130].
 */
import { readFileSync } from "node:fs";
import { EXT_CODE_ADDR, tableSlotIndex } from "../../src/abi/layout.ts";
import { decodeThumb16, isThumb32Prefix } from "../../src/hot/decode-thumb16.ts";
import { decodeThumb32 } from "../../src/hot/decode-thumb32.ts";
import { OP_NAMES, Op, unpackW0 } from "../../src/hot/opcodes.ts";
import { extractNamedExt } from "../../src/real/code6.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../../src/mythroad/index.ts";

const PACK = new Uint32Array(3);
const hx = (n: number) => "0x" + (n >>> 0).toString(16);

type Mem = { read16: (a: number) => number; read32: (a: number) => number };

function fmtThumb(pc: number, mem: Mem) {
  const hw1 = mem.read16(pc);
  if (isThumb32Prefix(hw1)) {
    const hw2 = mem.read16(pc + 2);
    decodeThumb32(hw1, hw2, PACK, 0);
    const u = unpackW0(PACK[0]!);
    const imm = PACK[1]! | 0;
    let extra = "";
    if (u.op === Op.BL || u.op === Op.B || u.op === Op.BLX) {
      extra = " target=" + hx((pc + 4 + imm) >>> 0);
    }
    return {
      size: 4,
      op: u.op,
      u,
      w1: PACK[1]! >>> 0,
      text: `${hx(pc)}  ${hw1.toString(16).padStart(4, "0")} ${hw2.toString(16).padStart(4, "0")}  ${OP_NAMES[u.op] ?? u.op} rd=${u.rd} rn=${u.rn} rm=${u.rm} w1=${hx(PACK[1]!)}${extra}`,
    };
  }
  decodeThumb16(hw1, PACK, 0);
  const u = unpackW0(PACK[0]!);
  return {
    size: 2,
    op: u.op,
    u,
    w1: PACK[1]! >>> 0,
    text: `${hx(pc)}  ${hw1.toString(16).padStart(4, "0")}  ${OP_NAMES[u.op] ?? u.op} rd=${u.rd} rn=${u.rn} rm=${u.rm} w1=${hx(PACK[1]!)}`,
  };
}

function disasmRange(mem: Mem, start: number, end: number): string[] {
  const lines: string[] = [];
  let p = start >>> 0;
  while (p < end) {
    const d = fmtThumb(p, mem);
    lines.push(d.text);
    p = (p + d.size) >>> 0;
  }
  return lines;
}

function findLe32(bytes: Uint8Array, value: number): number[] {
  const hits: number[] = [];
  const lo = value & 0xff;
  const b1 = (value >>> 8) & 0xff;
  const b2 = (value >>> 16) & 0xff;
  const b3 = (value >>> 24) & 0xff;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === lo && bytes[i + 1] === b1 && bytes[i + 2] === b2 && bytes[i + 3] === b3) hits.push(i);
  }
  return hits;
}

/** Thumb-16 word LDR/STR [Rn,#imm] where imm is byte offset. */
function scanThumb16WordLs(bytes: Uint8Array, dest: number, immBytes: number) {
  const hits: { va: number; hw: number; load: boolean; rn: number; rd: number; off: number }[] = [];
  const imm5 = immBytes >>> 2;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const hw = bytes[i]! | (bytes[i + 1]! << 8);
    if ((hw & 0xe000) !== 0x6000) continue;
    const b = (hw >>> 12) & 1;
    if (b) continue;
    const imm = (hw >>> 6) & 0x1f;
    if (imm !== imm5) continue;
    hits.push({
      va: (dest + i) >>> 0,
      hw,
      load: ((hw >>> 11) & 1) === 1,
      rn: (hw >>> 3) & 7,
      rd: hw & 7,
      off: imm << 2,
    });
  }
  return hits;
}

function scanThumb32WordLsImm(bytes: Uint8Array, dest: number, immWant: number) {
  const hits: { va: number; hw1: number; hw2: number; load: boolean; rn: number; rt: number; imm: number }[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 2) {
    const hw1 = bytes[i]! | (bytes[i + 1]! << 8);
    if ((hw1 & 0xfe40) !== 0xf840) continue;
    const size = (hw1 >>> 5) & 3;
    if (size !== 2) continue;
    const hw2 = bytes[i + 2]! | (bytes[i + 3]! << 8);
    let imm = -1;
    if ((hw1 & 0xfe80) === 0xf880) imm = hw2 & 0xfff;
    else if ((hw2 & 0x0d00) === 0x0c00 || (hw2 & 0x0f00) === 0x0e00 || (hw2 & 0x0b00) === 0x0900) imm = hw2 & 0xff;
    else continue;
    if (imm !== immWant) continue;
    hits.push({
      va: (dest + i) >>> 0,
      hw1,
      hw2,
      load: ((hw1 >>> 4) & 1) === 1,
      rn: hw1 & 0xf,
      rt: (hw2 >>> 12) & 0xf,
      imm,
    });
  }
  return hits;
}

const mrp = new Uint8Array(readFileSync(process.argv[2] ?? "test/fixtures/real/app.mrp"));
const cf = extractNamedExt(mrp, "cfunction.ext");
const dest = (EXT_CODE_ADDR + 8) >>> 0;

const lit270f = findLe32(cf, 0x270f);
const lit270d = findLe32(cf, 0x270d);
console.log("=== literals in cfunction.ext (file off → VA dest+off) ===");
console.log("0x270f", lit270f.map((o) => ({ off: hx(o), va: hx(dest + o) })));
console.log("0x270d", lit270d.map((o) => ({ off: hx(o), va: hx(dest + o) })));

console.log("\n=== Thumb16 [Rn,#0x1c] word ===");
for (const h of scanThumb16WordLs(cf, dest, 0x1c)) {
  console.log(`${hx(h.va)}  ${h.hw.toString(16)}  ${h.load ? "LDR" : "STR"} r${h.rd}, [r${h.rn}, #0x1c]`);
}
console.log("\n=== Thumb16 [Rn,#0x18] word (r4+0x18 == ER_RW+0x1c when r4=ER_RW+4) ===");
for (const h of scanThumb16WordLs(cf, dest, 0x18)) {
  console.log(`${hx(h.va)}  ${h.hw.toString(16)}  ${h.load ? "LDR" : "STR"} r${h.rd}, [r${h.rn}, #0x18]`);
}
console.log("\n=== Thumb32 word [Rn,#0x1c] ===");
for (const h of scanThumb32WordLsImm(cf, dest, 0x1c)) {
  console.log(`${hx(h.va)}  ${h.hw1.toString(16)} ${h.hw2.toString(16)}  ${h.load ? "LDR" : "STR"} r${h.rt}, [r${h.rn}, #0x1c]`);
}
console.log("\n=== Thumb32 word [Rn,#0x18] ===");
for (const h of scanThumb32WordLsImm(cf, dest, 0x18)) {
  console.log(`${hx(h.va)}  ${h.hw1.toString(16)} ${h.hw2.toString(16)}  ${h.load ? "LDR" : "STR"} r${h.rt}, [r${h.rn}, #0x18]`);
}

const rt = new MythroadRuntime({ graphics: new NullGraphicsBackend(), trace: new RuntimeTrace(), abiMode: "strict" });
const origBind = rt.bindExt.bind(rt);
rt.bindExt = (ext) => {
  origBind(ext);
  const e = rt.ext;
  if (!e) return;
  const origD = e.table.dispatch.bind(e.table);
  e.table.dispatch = (cpu, mem, pc) => {
    if (tableSlotIndex(pc) !== 130) {
      origD(cpu, mem, pc);
      return;
    }
    const mem16 = e.mem;
    console.log("\n=== helper after TestCom BL (0x01ea5ece) ===");
    console.log(disasmRange(mem16, 0x01ea5ece, 0x01ea5f40).join("\n"));
    console.log("\n=== next BL 0x01ea7f68 ===");
    console.log(disasmRange(mem16, 0x01ea7f68, 0x01ea8000).join("\n"));
    console.log("\n=== BL 0x01ea9254 ===");
    console.log(disasmRange(mem16, 0x01ea9254, 0x01ea9300).join("\n"));

    const ctxWindows = [
      ...scanThumb16WordLs(cf, dest, 0x1c).map((h) => h.va),
      ...scanThumb16WordLs(cf, dest, 0x18).filter((h) => h.rn === 4 || h.rn === 7).map((h) => h.va),
      ...scanThumb32WordLsImm(cf, dest, 0x1c).map((h) => h.va),
      ...lit270d.map((o) => dest + o),
      ...lit270f.map((o) => dest + o),
    ];
    const seen = new Set<number>();
    console.log("\n=== ±0x20 context around +0x1c / 0x270d / 0x270f sites ===");
    for (const va of ctxWindows) {
      const base = (va - 0x18) & ~1;
      if (seen.has(base)) continue;
      seen.add(base);
      console.log(`\n-- around ${hx(va)} --`);
      try {
        console.log(disasmRange(mem16, base, base + 0x30).join("\n"));
      } catch (err) {
        console.log("disasm fail", err instanceof Error ? err.message : err);
      }
    }
    origD(cpu, mem, pc);
  };
};
try {
  rt.loadMrp(mrp);
  rt.start("start.mr");
} catch (err) {
  console.log("\nthrow", err instanceof Error ? err.message : err);
}
