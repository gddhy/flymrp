#!/usr/bin/env npx tsx
import { readFileSync } from "node:fs";
import { GET_OPCODE, GETARG_A, GETARG_B, GETARG_Bx, GETARG_C, GETARG_sBx, OP_NAMES } from "../../src/lua/opcodes.ts";
import { LuaChunkReader } from "../../src/lua/chunk.ts";
import type { ColdProto } from "../../src/lua/types.ts";
import { MRPArchive } from "../../src/mrp/archive.ts";

const arc = MRPArchive.parse(
  new Uint8Array(readFileSync(process.argv[2] ?? "test/fixtures/real/app.mrp")),
);
const p = LuaChunkReader.load(arc.readFile("start.mr"));

function dump(p: ColdProto, indent = ""): void {
  console.log(`${indent}source=${p.source} nups=${p.nups} params=${p.numparams} code=${p.code.length} children=${p.p.length}`);
  p.k.forEach((c, i) => console.log(`${indent}  K[${i}]`, c));
  p.code.forEach((insn, i) => {
    const op = GET_OPCODE(insn);
    console.log(`${indent}  ${String(i).padStart(3)} ${OP_NAMES[op]!.padEnd(10)} A=${GETARG_A(insn)} B=${GETARG_B(insn)} C=${GETARG_C(insn)} Bx=${GETARG_Bx(insn)} sBx=${GETARG_sBx(insn)}`);
  });
  p.p.forEach((ch, i) => {
    console.log(`${indent}-- child ${i} --`);
    dump(ch, indent + "  ");
  });
}
dump(p);
