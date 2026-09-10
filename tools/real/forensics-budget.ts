#!/usr/bin/env npx tsx
/**
 * Stage 5-C.10Q forensic ARM instruction-budget sweep.
 * Forensic ARM instruction-budget sweep. Host gunzip is verification-only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORENSIC_INSN_BUDGETS,
  disasmBudgetStopStatic,
  renderInflateBudgetMarkdown,
  runInflateBudget,
  runInflateBudgetSweep,
} from "../../src/real/inflate-budget.ts";

function parseList(raw: string | undefined, fallback: readonly number[]): number[] {
  if (!raw) return [...fallback];
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

const args = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a.startsWith("--")) {
    const [k, inline] = a.slice(2).split("=");
    flags.set(k!, inline ?? args[++i] ?? "1");
  } else positional.push(a);
}

const path = resolve(positional[0] ?? "test/fixtures/real/app.mrp");
const mrp = new Uint8Array(readFileSync(path));
const budgets = parseList(flags.get("budgets"), FORENSIC_INSN_BUDGETS);
const repeat = Math.max(1, Number(flags.get("repeat") ?? 1) || 1);
const wantDiff = flags.has("diff");
const windows = parseList(flags.get("diff"), [100, 1000, 10_000]);

const staticDisasm = disasmBudgetStopStatic(mrp);
console.log("== static disasm ==");
console.log(`fnStart=0x${staticDisasm.fnStart.toString(16)}`);
for (const l of staticDisasm.around) console.log(l.text);
console.log("-- memcpy site --");
for (const l of staticDisasm.memcpySite) console.log(l.text);

if (repeat === 1 && budgets.length > 1) {
  const sweep = runInflateBudgetSweep(mrp, budgets);
  console.log(renderInflateBudgetMarkdown(sweep, staticDisasm));
  console.log("== JSON ==");
  console.log(
    JSON.stringify(
      {
        looping: sweep.looping,
        payloadLen: sweep.payloadLen,
        gzipIsize: sweep.gzipIsize,
        firstCompletion: sweep.firstCompletion && {
          budget: sweep.firstCompletion.budget,
          stopKind: sweep.firstCompletion.stopKind,
          thrown: sweep.firstCompletion.thrown,
          armExt0: sweep.firstCompletion.armExt0,
          lua: { resumed: sweep.firstCompletion.lua.resumed, insn: sweep.firstCompletion.lua.insn },
          unknownSlot: sweep.firstCompletion.unknownSlot,
        },
        runs: sweep.runs.map((r) => ({
          budget: r.budget,
          insnCount: r.insnCount,
          stopKind: r.stopKind,
          thrown: r.thrown,
          pc: r.cpu?.pc,
          cpsr: r.cpu?.cpsr,
          sp: r.cpu?.sp,
          lr: r.cpu?.lr,
          r9: r.cpu?.r9,
          hits: r.hits,
          allocs: r.allocs,
          progress: r.progress,
          armExt0: r.armExt0,
          luaResumed: r.lua.resumed,
          luaInsn: r.lua.insn,
          wallMs: r.wallMs,
          mips: r.mips,
          bridgeMs: r.bridgeMs,
          health: r.health,
          opcodes: r.opcodes && {
            decodedBlocks: r.opcodes.decodedBlocks,
            decodedInsns: r.opcodes.decodedInsns,
            arm: r.opcodes.arm,
            thumb16: r.opcodes.thumb16,
            thumb32: r.opcodes.thumb32,
            alu: r.opcodes.alu,
            mul: r.opcodes.mul,
            loadStore: r.opcodes.loadStore,
            ldmStm: r.opcodes.ldmStm,
            branch: r.opcodes.branch,
            shift: r.opcodes.shift,
            undef: r.opcodes.undef,
          },
          inflateConfirmed: r.inflateConfirmed,
          outputVerified: r.outputVerified,
        })),
      },
      null,
      2,
    ),
  );
} else {
  const runs = [];
  for (let i = 0; i < repeat; i++) {
    for (const b of budgets) {
      const r = runInflateBudget(mrp, { budget: b });
      runs.push(r);
      console.log(
        `run#${i + 1} budget=${b} insn=${r.insnCount} pc=0x${(r.cpu?.pc ?? 0).toString(16)} kind=${r.stopKind} prefix=${r.progress.prefixMatch}/${r.progress.referenceLen} t3=${r.hits.table3}`,
      );
    }
  }
  console.log("== JSON ==");
  console.log(
    JSON.stringify(
      runs.map((r) => ({
        budget: r.budget,
        insnCount: r.insnCount,
        pc: r.cpu?.pc,
        lr: r.cpu?.lr,
        thrown: r.thrown,
        prefix: r.progress.prefixMatch,
        table3: r.hits.table3,
        armExt0: r.armExt0,
      })),
      null,
      2,
    ),
  );
}

if (wantDiff) {
  const { runInflateWindowDiff } = await import("../../test/unicorn/inflate-window.ts");
  const diff = await runInflateWindowDiff(mrp, windows);
  console.log("== unicorn window ==");
  console.log(JSON.stringify(diff, null, 2));
}
