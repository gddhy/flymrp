import { describe, expect, it } from "vitest";
import { EXT_CODE_ADDR, EXT_TABLE_ADDR, MR_IGNORE, tableSlotAddr } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { DATA_SLOTS } from "../../src/abi/table.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";
import { OP_ADD, OP_MOV, armBlx, armBx, armDpImm, armDpReg, armLdrImm } from "../helpers/asm.ts";
import { buildArmTableCaller, buildThumbTableCaller, wordsToBytes } from "../helpers/ext-asm.ts";

describe("4-D 150-slot mr_table", () => {
  it("fixture: slot address is table_base + n*4", () => {
    expect(tableSlotAddr(0)).toBe(EXT_TABLE_ADDR);
    expect(tableSlotAddr(25)).toBe(EXT_TABLE_ADDR + 100);
    expect(tableSlotAddr(149)).toBe(EXT_TABLE_ADDR + 149 * 4);
    const rt = new ExtRuntime();
    expect(rt.mem.read32(tableSlotAddr(4))).toBe(tableSlotAddr(4));
    expect(DATA_SLOTS.has(91)).toBe(true);
    expect(rt.table.isExec(91)).toBe(false);
    expect(rt.table.isExec(4)).toBe(true);
  });

  it("fixture: ARM caller → table add handler", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(5, (_c, _m, args) => (args[0] + args[1]) >>> 0);
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, buildArmTableCaller({ dest, slot: 5, r0: 3, r1: 4 }));
    const out = rt.runGuest(dest, { thumb: 0 });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(7);
  });

  it("fixture: Thumb caller → table constant + T bit restore", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(4, () => 0x51);
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, buildThumbTableCaller({ dest, slot: 4, r0: 1, r1: 2 }));
    const out = rt.runGuest(dest | 1, { thumb: 1 });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0x51);
    expect(rt.cpu.t).toBe(0);
  });

  it("fixture: Thumb caller keeps T when LR has thumb bit", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(4, () => 0x44);
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, buildThumbTableCaller({ dest, slot: 4, r0: 0, r1: 0 }));
    const out = rt.runGuest(dest, { thumb: 1, lr: 0x0007_fff1 });
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0x44);
    expect(rt.cpu.t).toBe(1);
  });

  it("fixture: nested table call (slot 4 then slot 5)", () => {
    const rt = new ExtRuntime();
    rt.registerHandler(4, () => 10);
    rt.registerHandler(5, () => 3);
    const dest = EXT_CODE_ADDR;
    const words = [
      armDpReg(OP_MOV, 0, 0, 6, 14),
      armLdrImm(4, 15, 24),
      armBlx(4),
      (0xe << 28) | (OP_MOV << 21) | (1 << 12) | 0,
      armLdrImm(4, 15, 16),
      armBlx(4),
      (0xe << 28) | (OP_ADD << 21) | (0 << 16) | (0 << 12) | 1,
      armBx(6),
      tableSlotAddr(4),
      tableSlotAddr(5),
    ];
    // +4 LDR PC+8=+12 imm24 → +36 = words[9] slot5? words[8] is +32 slot4, words[9] +36 slot5
    // inst1 dest+4 PC+8=dest+12 imm24 → dest+36 = words[9] YES slot5 — want slot4 first
    // inst1 should load slot4 at words[8]=dest+32. dest+12+imm=dest+32 → imm=20
    words[1] = armLdrImm(4, 15, 20);
    // inst4 dest+16 PC+8=dest+24 want dest+36 slot5 → imm=12
    words[4] = armLdrImm(4, 15, 12);
    rt.pokeCode(dest, wordsToBytes(words));
    const out = rt.runGuest(dest);
    expect(out.r0).toBe(13);
  });

  it("fixture: jumping to a data slot is InvalidSlot", () => {
    const rt = new ExtRuntime();
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, wordsToBytes([armLdrImm(0, 15, 4), armBx(0), tableSlotAddr(91)]));
    // dest+0 LDR R0,[PC,#4] → dest+12, but we only have 3 words...
    // dest+0: LDR R0,[PC,#4] PC+8=dest+8 +4=dest+12 — too far
    // dest+0: LDR R0,[PC,#0] PC+8=dest+8, word at dest+8 is words[2]
    rt.pokeCode(dest, wordsToBytes([armLdrImm(0, 15, 0), armBx(0), tableSlotAddr(91)]));
    const out = rt.runGuest(dest);
    expect(out.kind).toBe(ExtStopKind.InvalidSlot);
  });

  it("fixture: LDR of a data slot is ordinary memory, not a table call", () => {
    const rt = new ExtRuntime();
    const slot = rt.mem.read32(tableSlotAddr(91));
    rt.mem.write32(slot, 0xcafebabe);
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(
      dest,
      wordsToBytes([
        armLdrImm(0, 15, 8),
        armLdrImm(0, 0, 0, 1),
        armLdrImm(0, 0, 0, 1),
        armBx(14),
        tableSlotAddr(91),
      ]),
    );
    const out = rt.runGuest(dest);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(0xcafebabe);
    expect(rt.bridgeCalls).toBe(0);
  });

  it("fixture: unimplemented exec slot returns MR_IGNORE", () => {
    const rt = new ExtRuntime();
    const dest = EXT_CODE_ADDR;
    rt.pokeCode(dest, buildArmTableCaller({ dest, slot: 40, r0: 0, r1: 0 }));
    const out = rt.runGuest(dest);
    expect(out.kind).toBe(ExtStopKind.Return);
    expect(out.r0).toBe(MR_IGNORE);
  });
});
