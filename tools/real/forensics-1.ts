#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10N read-only probe. Does not register table[1].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  firstFitReuseSameSize,
  flymrpBumpSecond,
  renderFree1Markdown,
  runFree1Forensics,
} from "../../src/real/free1.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runFree1Forensics(new Uint8Array(readFileSync(path)));
console.log(renderFree1Markdown(r));
const model = firstFitReuseSameSize(132);
console.log("== first-fit model ==");
console.log(JSON.stringify({ ...model, bumpSecond: flymrpBumpSecond(model.first, 132) }, null, 2));
console.log("== JSON ==");
console.log(
  JSON.stringify(
    {
      productionThrown: r.productionThrown,
      probeThrown: r.probeThrown,
      handler1: r.handler1,
      handler0: r.handler0,
      cpu: {
        pc: r.cpu.pc,
        lr: r.cpu.lr,
        sp: r.cpu.sp,
        insnCount: r.cpu.insnCount,
        r0: r.cpu.r[0],
        r1: r.cpu.r[1],
        r2: r.cpu.r[2],
        r3: r.cpu.r[3],
        r5: r.cpu.r[5],
        r6: r.cpu.r[6],
        r7: r.cpu.r[7],
        stack0: r.cpu.stack0,
        stack4: r.cpu.stack4,
      },
      table0: r.table0,
      headerAfterTable0: r.headerAfterTable0,
      headerAtTable1: r.headerAtTable1,
      headerBytes: r.headerBytes,
      payloadBytes: r.payloadBytes.slice(0, 13),
      registryMatch: r.registryMatch,
      wrapCaller: r.wrapCaller,
      mallocWrap: r.mallocWrap.map((l) => l.text),
      freeWrap: r.freeWrap.map((l) => l.text),
      afterCaller: r.afterCaller.map((l) => l.text),
      table1Inline: r.table1Inline.length,
      freeWrapBls: r.freeWrapBls,
      nextStaticSlots: r.nextStaticSlots,
      nextChain: r.nextChain,
      decision: r.decision,
    },
    null,
    2,
  ),
);
