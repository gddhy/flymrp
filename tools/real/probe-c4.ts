#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { AEX_P_ER_RW_OFF } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { tableSlotIndex } from "../../src/abi/layout.ts";
import { MRPArchive } from "../../src/mrp/archive.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../../src/mythroad/index.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";

const mrp = new Uint8Array(readFileSync(process.argv[2] ?? "test/fixtures/real/app.mrp"));
const vfs = new MythroadVfs();
vfs.attach(MRPArchive.parse(mrp));
const bytes = vfs.readFile("cfunction.ext")!;
const ext = new ExtRuntime();
const slots: { n: number; r0: number; r1: number; r2: number; lr: number }[] = [];
const orig = ext.table.dispatch.bind(ext.table);
ext.table.dispatch = (cpu, mem, pc) => {
  const n = tableSlotIndex(pc);
  if (n >= 0 && n < 150 && ext.table.isExec(n)) {
    slots.push({ n, r0: cpu.r[0] >>> 0, r1: cpu.r[1] | 0, r2: cpu.r[2] | 0, lr: cpu.r[14] >>> 0 });
  }
  orig(cpu, mem, pc);
};
new MrTableBridge(ext, vfs, "probe").install();
const out = ext.load(bytes, { loadCode: 0 });
const p = ext.owners.wrapper.p;
const helper = ext.owners.wrapper.helper;
console.log("isolated+malloc", {
  kind: out.kind,
  ret: out.ret,
  insn: ext.cpu.insnCount,
  dest4: (ext.mem.read32(ext.codeBase + 4) >>> 0).toString(16),
  p: (p >>> 0).toString(16),
  helper: (helper >>> 0).toString(16),
  rw: p ? (ext.mem.read32(p + AEX_P_ER_RW_OFF) >>> 0).toString(16) : "0",
  rwLen: p ? ext.mem.read32(p + 4) : 0,
  slots,
});

const tr = new RuntimeTrace();
const rt = new MythroadRuntime({ graphics: new NullGraphicsBackend(), trace: tr, abiMode: "strict" });
try {
  rt.loadMrp(mrp);
  rt.start("start.mr");
  console.log("start returned", rt.exited, rt.ext?.owners.wrapper);
} catch (e) {
  const e2 = rt.ext;
  const p2 = e2?.owners.wrapper.p ?? 0;
  console.log("full throw", e instanceof Error ? `${e.name}: ${e.message}` : e);
  console.log("full state", e2 && {
    dest4: (e2.mem.read32(e2.codeBase + 4) >>> 0).toString(16),
    owners: e2.owners,
    rw: p2 ? (e2.mem.read32(p2 + AEX_P_ER_RW_OFF) >>> 0).toString(16) : "noP",
    rwLen: p2 ? e2.mem.read32(p2 + 4) : 0,
    r9: (e2.cpu.r[9] >>> 0).toString(16),
    t: e2.cpu.t,
    pc: (e2.cpu.r[15] >>> 0).toString(16),
    lr: (e2.cpu.r[14] >>> 0).toString(16),
    unknown: rt.unknownRequiredSlot,
    mrReads: rt.mrReads,
  });
  console.log(
    "trace tail",
    tr.records.slice(-16).map((x) => `${x.sequence} ${x.operation} ${JSON.stringify(x.arguments)} => ${JSON.stringify(x.returnValue)}`),
  );
}
