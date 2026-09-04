#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10D read-only probe. Does not register table[33].
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGetTime33Markdown, runGetTime33Forensics } from "../../src/real/gettime33.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runGetTime33Forensics(new Uint8Array(readFileSync(path)));
console.log(renderGetTime33Markdown(r));
console.log("== JSON ==");
console.log(
  JSON.stringify(
    {
      handler130: r.handler130,
      handler38: r.handler38,
      handler33: r.handler33,
      productionThrown: r.productionThrown,
      probeThrown: r.probeThrown,
      cpu: r.cpu,
      p: r.p,
      helper: r.helper,
      erRw: r.erRw,
      owner: r.owner,
      wrapBlx: r.encodings.wrapBlx,
      storeHw: r.encodings.storeHw,
      callerGetTimeTarget: r.encodings.callerGetTimeTarget,
      callerStoreTarget: r.encodings.callerStoreTarget,
      storeLiteral: r.encodings.storeLiteral,
      gotSequences: r.gotSequences,
      wrapXrefs: r.wrapXrefs,
      storeXrefs: r.storeXrefs,
      literals4358: r.literals4358,
      init2Reached: r.init2Reached,
    },
    null,
    2,
  ),
);
