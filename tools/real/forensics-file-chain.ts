#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10J read-only probe. Does not register table[40]/41+ or file handles.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderFileChainMarkdown, runFileChainForensics } from "../../src/real/filechain.ts";

const path = resolve(process.argv[2] ?? "test/fixtures/real/app.mrp");
const r = runFileChainForensics(new Uint8Array(readFileSync(path)));
console.log(renderFileChainMarkdown(r));
console.log("== JSON ==");
console.log(
  JSON.stringify(
    {
      productionThrown: r.productionThrown,
      probeThrown: r.probeThrown,
      lookfor: r.lookfor,
      readFileName: r.readFileName,
      entryR0: r.entryR0,
      entryR1: r.entryR1,
      entryR2: r.entryR2,
      packName: r.packName,
      packFilenameAt40: r.packFilenameAt40,
      resourceNameAt40: r.resourceNameAt40,
      fileSlotsInFn: r.fileSlotsInFn,
      nextUnimplementedFileSlot: r.nextUnimplementedFileSlot,
      cmp16: r.cmp16,
      cmp232: r.cmp232,
      efsBranchHw: r.efsBranchHw,
      inlineReadOff: r.inlineReadOff,
      archiveBytes: r.archiveBytes,
      archiveSameRef: r.archiveSameRef,
      archiveMagic: r.archiveMagic,
      fileStart: r.fileStart,
      listStart: r.listStart,
      indexLen: r.indexLen,
      vfsHasPackName: r.vfsHasPackName,
      vfsHasResLang: r.vfsHasResLang,
      handlers: r.handlers,
      wraps: r.wraps,
      bls: r.bls.filter((b) => b.slot !== null),
      design: r.design,
    },
    null,
    2,
  ),
);
