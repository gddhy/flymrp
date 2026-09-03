#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { GET_OPCODE, GETARG_A, GETARG_B, GETARG_Bx, GETARG_C, GETARG_sBx, OP_NAMES } from "../../src/lua/opcodes.ts";
import { LuaChunkReader } from "../../src/lua/chunk.ts";
import { MRPArchive } from "../../src/mrp/archive.ts";
import { MythroadRuntime, NullGraphicsBackend, RuntimeTrace } from "../../src/mythroad/index.ts";

const path = process.argv[2] ?? "test/fixtures/real/app.mrp";
const bytes = new Uint8Array(readFileSync(path));
const arc = MRPArchive.parse(bytes);
const starts = arc.entries.filter((e) => e.name === "start.mr");
console.log("start.mr copies:", starts.length, starts.map((e) => ({ off: e.offset, len: e.storedLength })));

function disasm(label: string, data: Uint8Array): void {
  const p = LuaChunkReader.load(data);
  console.log(`\n== ${label} source=${p.source} code=${p.code.length} k=${p.k.length} ==`);
  for (let i = 0; i < p.k.length; i++) {
    const c = p.k[i]!;
    console.log(`  K[${i}]`, c);
  }
  for (let i = 0; i < p.code.length; i++) {
    const insn = p.code[i]!;
    const op = GET_OPCODE(insn);
    console.log(
      `  ${String(i).padStart(3)} ${OP_NAMES[op]!.padEnd(10)} A=${GETARG_A(insn)} B=${GETARG_B(insn)} C=${GETARG_C(insn)} Bx=${GETARG_Bx(insn)} sBx=${GETARG_sBx(insn)}`,
    );
  }
}

const first = arc.readFile("start.mr");
disasm("find() first start.mr", first);

// second copy: read raw slice via entries[3] if present
if (starts[1]) {
  const raw = bytes.subarray(starts[1].offset, starts[1].offset + starts[1].storedLength);
  const { isGzip, gunzip } = await import("../../src/mrp/gzip.ts");
  const payload = isGzip(raw) ? gunzip(raw) : raw;
  disasm("second start.mr", payload);
}

const g = new NullGraphicsBackend();
const tr = new RuntimeTrace();
const rt = new MythroadRuntime({ graphics: g, trace: tr, abiMode: "strict" });
try {
  rt.loadMrp(bytes);
  rt.start("start.mr");
  console.log("start returned, exited=", rt.exited, "state=", rt.state);
} catch (e) {
  console.log("\nTHROW", e instanceof Error ? `${e.name}: ${e.message}` : e);
}
console.log("\n== TRACE ==");
for (const rec of tr.records) {
  console.log(`${rec.sequence} [${rec.phase}] ${rec.operation}`, JSON.stringify(rec.arguments), "=>", JSON.stringify(rec.returnValue));
}
console.log("unknown", JSON.stringify(rt.unknownEvents, null, 2));
console.log("gfx", g.commands.length, "ext", !!rt.ext);
