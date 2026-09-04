#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10H read-only probe. Does not register table[40].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderOpen40Markdown, runOpen40Forensics } from "../../src/real/open40.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runOpen40Forensics(new Uint8Array(readFileSync(path)));
console.log(renderOpen40Markdown(r));
console.log("== JSON ==");
console.log(
  JSON.stringify(
    {
      handler130: r.handler130,
      handler38: r.handler38,
      handler33: r.handler33,
      handler17: r.handler17,
      handler40: r.handler40,
      productionThrown: r.productionThrown,
      probeThrown: r.probeThrown,
      cpu: r.cpu,
      r0Text: r.r0Text,
      r6Text: r.r6Text,
      packSlotAddr: r.packSlotAddr,
      packPtr: r.packPtr,
      packBytes: r.packBytes,
      packDataSlotIndex: r.packDataSlotIndex,
      heapExpected: r.heapExpected,
      erRwPackWord: r.erRwPackWord,
      writes: r.writes,
      mallocs: r.mallocs,
      filenameFromMalloc: r.filenameFromMalloc,
      helperSnaps: r.helperSnaps,
      wrapHw: r.encodings.wrapHw,
      afterHw: r.encodings.afterHw,
      consumerBlTarget: r.encodings.consumerBlTarget,
      stubLoadSites: r.encodings.stubLoadSites,
      wrapXrefs: r.wrapXrefs,
      modeCensus: r.modeCensus,
      callsites: r.callsites,
      archiveHasResLang: r.archiveHasResLang,
      vfsExistsResLang: r.vfsExistsResLang,
      vfsExistsEmpty: r.vfsExistsEmpty,
      table125AfterSprintf: r.table125AfterSprintf,
      decision: r.decision,
    },
    null,
    2,
  ),
);
