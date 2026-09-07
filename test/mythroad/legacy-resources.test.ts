import { expect, it } from "vitest";
import { buildMrp, MRPArchive } from "../../src/mrp/index.ts";
import { MythroadRuntime } from "../../src/mythroad/runtime.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { tableSlotAddr } from "../../src/abi/layout.ts";
import { defaultProfile } from "../../src/mythroad/profile.ts";

it("resolves uniquely folded legacy resource names and preserves exact-name precedence", () => {
  const a = MRPArchive.parse(buildMrp([{name:"uid.scene",data:new Uint8Array([1,2])}]));
  expect([...a.readFile("UID.scene")]).toEqual([1,2]);
  const b = MRPArchive.parse(buildMrp([{name:"A",data:new Uint8Array([1])},{name:"a",data:new Uint8Array([2])}]));
  expect([...b.readFile("A")]).toEqual([1]); expect([...b.readFile("a")]).toEqual([2]);
  const c = MRPArchive.parse(buildMrp([{name:"Map",data:new Uint8Array([1])},{name:"map",data:new Uint8Array([2])}]));
  expect(c.hasFile("MAP")).toBe(false);
});

it("converts table[132] GBK to an allocated UCS2BE string and reports its terminated byte size", () => {
  const rt = new MythroadRuntime(), ext = new ExtRuntime(); rt.bindExt(ext);
  const input=ext.alloc(8), error=ext.alloc(4), size=ext.alloc(4);
  ext.mem.load(input,[0xd6,0xd0,0x41,0]);
  const out=ext.runGuest(tableSlotAddr(132),{r0:input,r1:error,r2:size});
  expect([...ext.mem.slice(out.r0,6)]).toEqual([0x4e,0x2d,0,0x41,0,0]);
  expect(ext.mem.read32(size)).toBe(6); expect(ext.mem.read32(error)).toBe(0xffffffff);
});

it("uses a period handset date by default and honors an explicit date", () => {
  expect(defaultProfile().datetime.year).toBe(2011);
  expect(defaultProfile({datetime:{year:2026,month:9,day:7,hour:12,minute:0,second:0}}).datetime.year).toBe(2026);
});
