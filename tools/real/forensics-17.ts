#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10F read-only probe. Does not register table[17].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSprintf17Markdown, runSprintf17Forensics } from "../../src/real/sprintf17.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runSprintf17Forensics(new Uint8Array(readFileSync(path)));
console.log(renderSprintf17Markdown(r));
console.log("== JSON ==");
console.log(
  JSON.stringify(
    {
      handler130: r.handler130,
      handler38: r.handler38,
      handler33: r.handler33,
      handler17: r.handler17,
      productionThrown: r.productionThrown,
      probeThrown: r.probeThrown,
      cpu: r.cpu,
      format: r.format,
      formatAscii: r.formatAscii,
      langVal: r.langVal,
      got17: r.got17,
      got26: r.got26,
      wrapHw: r.encodings.wrapHw,
      afterHw: r.encodings.afterHw,
      litGot: r.encodings.litGot,
      parentBlTarget: r.encodings.parentBlTarget,
      callerBlTarget: r.encodings.callerBlTarget,
      consumerBlTarget: r.encodings.consumerBlTarget,
      wrapXrefs: r.wrapXrefs,
      callsites: r.callsites,
      specCensus: r.specCensus,
      liveSpecs: r.liveSpecs,
      staticSpecs: r.staticSpecs,
      writableToStackTop: r.writableToStackTop,
    },
    null,
    2,
  ),
);
