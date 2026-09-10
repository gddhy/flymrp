import { extractNamedExt } from "./code6.ts";
import { TESTCOM130, runTestCom130Forensics } from "./testcom130.ts";

const MAP = 0x01e8_0000;

export const TESTCOM130_DEP = {
  pop: TESTCOM130.pop,
  helperResume: 0x01ea5ed2,
  nextInit: 0x01ea7f68,
  nextInit2: 0x01ea9254,
  r0Overwrite: 0x01eab1ac,
  helperEpilogue: 0x01ea5f3c,
  consumerFunc: 0x01ea6e2c,
  consumers: [
    { cmp: 0x01ea6e8e, load: 0x01ea6e8c, lit270d: 0x01ea6f80, r9Off: 4 },
    { cmp: 0x01ea71d2, load: 0x01ea71d0, lit270d: 0x01ea73a0, r9Off: 4 },
    { cmp: 0x01ea7478, load: 0x01ea7476, lit270d: 0x01ea7544, r9Off: 4 },
  ],
} as const;

export type TestCom130DepReport = {
  handlerPresent: boolean;
  thrown: string;
  encodings: {
    cmp: number;
    bne: number;
    sub2: number;
    str: number;
    pop: number;
  };
  pathA: { writesErRw1c: false; resume: number };
  pathB: { writesErRw1c: true; stored: number; resume: number };
  helperAfter: { bl1: number; bl2: number; epilogue: number };
  r0ConsumedByNextBl: false;
  literals270f: number[];
  literals270d: number[];
  consumers: { va: number; r9Off: number; erOff: number; cmpImm: number }[];
  consumerBlFromInit: boolean;
};

function findLe32(bytes: Uint8Array, value: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i + 3 < bytes.length; i++) {
    const w = (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0;
    if (w === value) hits.push((MAP + i) >>> 0);
  }
  return hits;
}

/**
 * Static CFG / literal forensics for table[130] return-value dependence.
 * Does not register a handler. Does not execute either return path.
 */
export function runTestCom130DepForensics(mrp: Uint8Array): TestCom130DepReport {
  const live = runTestCom130Forensics(mrp);
  const cf = extractNamedExt(mrp, "cfunction.ext");
  const literals270f = findLe32(cf, 0x270f);
  const literals270d = findLe32(cf, 0x270d);

  return {
    handlerPresent: live.handlerPresent,
    thrown: live.thrown,
    encodings: {
      cmp: live.encodings.cmp,
      bne: live.encodings.bne,
      sub2: live.encodings.sub2,
      str: live.encodings.str,
      pop: 0xbdb0,
    },
    pathA: { writesErRw1c: false, resume: TESTCOM130_DEP.helperResume },
    pathB: { writesErRw1c: true, stored: 0x270d, resume: TESTCOM130_DEP.helperResume },
    helperAfter: {
      bl1: TESTCOM130_DEP.nextInit,
      bl2: TESTCOM130_DEP.nextInit2,
      epilogue: TESTCOM130_DEP.helperEpilogue,
    },
    r0ConsumedByNextBl: false,
    literals270f,
    literals270d,
    consumers: TESTCOM130_DEP.consumers.map((c) => ({
      va: c.cmp,
      r9Off: c.r9Off,
      erOff: (c.r9Off + 0x18) >>> 0,
      cmpImm: 0x270d,
    })),
    consumerBlFromInit: false,
  };
}

export function renderTestCom130DepMarkdown(r: TestCom130DepReport): string {
  return [
    "# table[130] return-value dependence (Stage 5-C.7)",
    "",
    "Forensics only. **table[130] is not implemented. Stage 5-D NOT STARTED.**",
    "",
    "```text",
    `A  r0=0      → skip store → ${r.pathA.resume.toString(16)}`,
    `B  r0=0x270f → STR 0x270d → ER_RW+0x1c → ${r.pathB.resume.toString(16)}`,
    `   helper    → BL ${r.helperAfter.bl1.toString(16)} → BL ${r.helperAfter.bl2.toString(16)} → epilogue`,
    `   next BL overwrites r0 (0x01eab1ac); TestCom r0 discarded`,
    "```",
    "",
    `- 0x270f literals: ${r.literals270f.map((n) => "0x" + n.toString(16)).join(", ")}`,
    `- 0x270d literals: ${r.literals270d.map((n) => "0x" + n.toString(16)).join(", ")}`,
    `- ER_RW+0x1c consumers: ${r.consumers.map((c) => "0x" + c.va.toString(16)).join(", ")}`,
    `- consumer BL from helper code-0 after TestCom: ${r.consumerBlFromInit}`,
    `- handler present: ${r.handlerPresent}`,
    `- throw: ${r.thrown}`,
    "",
  ].join("\n");
}
