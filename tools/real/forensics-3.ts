#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10L read-only probe. Does not register table[3]/[10]/[1].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderMemcpy3Markdown, runMemcpy3Forensics } from "../../src/real/memcpy3.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runMemcpy3Forensics(new Uint8Array(readFileSync(path)));
console.log(renderMemcpy3Markdown(r));
console.log("== JSON ==");
console.log(
  JSON.stringify(
    {
      productionThrown: r.productionThrown,
      probeThrown: r.probeThrown,
      handler3: r.handler3,
      handler10: r.handler10,
      handler1: r.handler1,
      handler40: r.handler40,
      cpu: {
        pc: r.cpu.pc,
        lr: r.cpu.lr,
        sp: r.cpu.sp,
        cpsr: r.cpu.cpsr,
        tBit: r.cpu.tBit,
        insnCount: r.cpu.insnCount,
        r0: r.cpu.r[0],
        r1: r.cpu.r[1],
        r2: r.cpu.r[2],
        r3: r.cpu.r[3],
        r4: r.cpu.r[4],
        r5: r.cpu.r[5],
        r6: r.cpu.r[6],
        r7: r.cpu.r[7],
        r8: r.cpu.r[8],
        r9: r.cpu.r9,
      },
      p: r.p,
      helper: r.helper,
      erRw: r.erRw,
      srcBytes: r.srcBytes.slice(0, 8),
      srcU32: r.srcU32,
      archiveBytes: r.archiveBytes.slice(0, 8),
      overlap: r.overlap,
      returnConsumer: r.returnConsumer,
      table3: r.table3Calls.map((c) => ({ blx: c.blx, inReadFile: c.inReadFile, kind: c.kind })),
      table10: r.table10Calls.map((c) => ({ blx: c.blx, inReadFile: c.inReadFile, kind: c.kind })),
      table1Count: r.table1Calls.length,
      decision: r.decision,
    },
    null,
    2,
  ),
);
