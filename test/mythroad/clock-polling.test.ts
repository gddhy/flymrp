import { expect, it } from "vitest";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { tableSlotAddr } from "../../src/abi/layout.ts";
import { MrTableBridge } from "../../src/mythroad/mr-table.ts";
import { MythroadVfs } from "../../src/mythroad/vfs.ts";
import { ExtStopKind } from "../../src/abi/fault.ts";

it("lets a synchronous ARM millisecond delay finish without host ticks", () => {
  const ext = new ExtRuntime(), bridge = new MrTableBridge(ext,new MythroadVfs(),"poll"); bridge.install();
  const code = ext.alloc(64);
  // Load table[33], save caller LR, and poll until the clock reaches 2 ms.
  ext.mem.write32(code, 0xe59f5018); // ldr r5, [pc,#24] = code+32
  ext.mem.write32(code+4,0xe1a0400e);
  ext.mem.write32(code+8,0xe1a0e00f);
  ext.mem.write32(code+12,0xe12fff15);
  ext.mem.write32(code+16,0xe3500002);
  ext.mem.write32(code+20,0x3afffffb); // bcc code+8
  ext.mem.write32(code+24,0xe12fff14);
  ext.mem.write32(code+32,tableSlotAddr(33));
  ext.insnBudget=100_000;
  expect(ext.runGuest(code).kind).toBe(ExtStopKind.Return);
  expect(bridge.clock).toBe(2);
  expect(ext.runGuest(tableSlotAddr(33)).r0).toBe(2);
  // A true endless branch still reaches the instruction watchdog.
  ext.mem.write32(code,0xeafffffe); ext.cache.invalidate(code,4); ext.insnBudget=32;
  expect(ext.runGuest(code).kind).toBe(ExtStopKind.AbiFault);
});
