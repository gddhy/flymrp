#!/usr/bin/env npx tsx
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXT_CODE_ADDR, EXT_TABLE_ADDR, tableSlotIndex } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { MRPArchive } from "../../src/mrp/archive.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../../src/mythroad/index.ts";

const path = process.argv[2] ?? resolve("test/fixtures/real/app.mrp");
const bytes = new Uint8Array(readFileSync(path));
const sha = createHash("sha256").update(bytes).digest("hex");
const arc = MRPArchive.parse(bytes);

console.log("path", path);
console.log("sha256", sha, "size", bytes.length);
console.log("header", arc.header);
console.log("entries", arc.entries.length);
const starts = arc.entries.filter((e) => e.name === "start.mr");
console.log("start.mr copies", starts.length, starts.map((e) => ({ off: e.offset, stored: e.storedLength })));
const exts = arc.entries.filter((e) => e.name.endsWith(".ext"));
for (const e of exts) {
  const data = arc.readFile(e.name);
  const magic = String.fromCharCode(...data.subarray(0, 8));
  console.log("ext", e.name, "stored", e.storedLength, "raw", data.length, "magic", JSON.stringify(magic), "sha", createHash("sha256").update(data).digest("hex"));
}

const loader = arc.readFile("mrc_loader.ext");
console.log("\n== mrc_loader hex ==");
for (let i = 0; i < loader.length; i += 16) {
  const slice = loader.subarray(i, i + 16);
  const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  console.log(i.toString(16).padStart(4, "0"), hex);
}

const slotLog: string[] = [];
const ext = new ExtRuntime();
const orig = ext.table.dispatch.bind(ext.table);
ext.table.dispatch = (cpu, mem, pc) => {
  const n = tableSlotIndex(pc);
  slotLog.push(`call slot ${n} r0=${cpu.r[0] >>> 0} r1=${cpu.r[1] >>> 0} r2=${cpu.r[2] >>> 0} r3=${cpu.r[3] >>> 0} lr=${(cpu.r[14] >>> 0).toString(16)}`);
  orig(cpu, mem, pc);
  slotLog.push(`  ret slot ${n} r0=${cpu.r[0] >>> 0}`);
};

console.log("\n== ExtRuntime.load(mrc_loader) ==");
try {
  const loaded = ext.load(loader, { loadCode: 0 });
  console.log("kind", loaded.kind, "r0", loaded.ret | 0, "unsigned", loaded.ret >>> 0);
  console.log("mapped dest", loaded.mapped.dest.toString(16), "len", loaded.mapped.length, "loadAddr", loaded.mapped.loadAddr.toString(16));
  console.log("header words", {
    t: ext.mem.read32(EXT_CODE_ADDR).toString(16),
    p: ext.mem.read32(EXT_CODE_ADDR + 4).toString(16),
    w8: ext.mem.read32(EXT_CODE_ADDR + 8).toString(16),
  });
  console.log("owners", {
    wrapper: ext.owners.wrapper,
    primary: ext.owners.primary,
    active: ext.owners.active,
  });
} catch (e) {
  console.log("LOAD THROW", e instanceof Error ? `${e.name}: ${e.message}` : e);
}
console.log("slot log during load:");
for (const l of slotLog) console.log(" ", l);

slotLog.length = 0;
console.log("\n== arm_ext_call(1, empty) ==");
try {
  const out = ext.arm_ext_call(1, new Uint8Array());
  console.log("kind", out.kind, "r0", out.r0 | 0, "outLen", out.outputLen, "outHex", Buffer.from(out.output).toString("hex"));
} catch (e) {
  console.log("CALL THROW", e instanceof Error ? `${e.name}: ${e.message}` : e);
}
console.log("slot log during call:");
for (const l of slotLog) console.log(" ", l);

console.log("\n== Mythroad start ==");
const g = new NullGraphicsBackend();
const tr = new RuntimeTrace();
const rt = new MythroadRuntime({ graphics: g, trace: tr, abiMode: "strict" });
try {
  rt.loadMrp(bytes);
  rt.start("start.mr");
  console.log("returned exited=", rt.exited, "state=", rt.state);
} catch (e) {
  console.log("THROW", e instanceof Error ? `${e.name}: ${e.message}` : e);
}
for (const rec of tr.records) {
  const args = JSON.stringify(rec.arguments);
  const ret = JSON.stringify(rec.returnValue);
  const a = args.length > 180 ? args.slice(0, 180) + "…" : args;
  const r = ret.length > 120 ? ret.slice(0, 120) + "…" : ret;
  console.log(`${rec.sequence} [${rec.phase}] ${rec.operation} ${a} => ${r}`);
}
console.log("unknown", JSON.stringify(rt.unknownEvents));
console.log("ext?", !!rt.ext, "gfx", g.commands.length);
void EXT_TABLE_ADDR;
