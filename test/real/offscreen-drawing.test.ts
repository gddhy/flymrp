import { describe, expect, it } from "vitest";
import { tableSlotAddr, stackTop } from "../../src/abi/layout.ts";
import { ExtRuntime } from "../../src/abi/runtime.ts";
import { DRAW_BM_COPY, MrTableBridge, MythroadVfs, makeRgb565 } from "../../src/mythroad/index.ts";
function setup() {
  const ext = new ExtRuntime(), bridge = new MrTableBridge(ext, new MythroadVfs(), "offscreen"); bridge.install();
  const global = (slot: number) => ext.mem.read32(tableSlotAddr(slot));
  const lcd = ext.mem.read32(global(91));
  const target = ext.alloc(32);
  const redirect = () => { ext.mem.write32(global(91), target); ext.mem.write32(global(92), 4); ext.mem.write32(global(93), 4); };
  const restore = () => { ext.mem.write32(global(91), lcd); ext.mem.write32(global(92), 240); ext.mem.write32(global(93), 320); };
  return { ext, bridge, target, redirect, restore, global };
}
describe("guest offscreen drawing", () => {
  it("draws rects and points into the selected buffer with its own stride and clipping", () => {
    const { ext, bridge, target, redirect, restore } = setup(); redirect();
    bridge.drawRect(new Uint32Array([1,1,3,2,255,0,0])); bridge.drawPoint(2,2,0x07e0); bridge.drawPoint(4,2,0xffff);
    expect(ext.mem.read16(target + 10)).toBe(makeRgb565(255,0,0));
    expect(ext.mem.read16(target + 20)).toBe(0x07e0); expect(ext.mem.read16(target + 24)).toBe(0);
    expect(bridge.screen.pixels.every(p => p === 0)).toBe(true);
    restore(); bridge.drawPoint(2,2,0x001f); expect(bridge.screen.pixels[482]).toBe(0x001f);
    expect(ext.mem.read16(target + 20)).toBe(0x07e0);
  });
  it("pre-renders a bitmap offscreen, then copies the populated background onto the LCD", () => {
    const { ext, bridge, target, redirect, restore } = setup(); const source = ext.alloc(8);
    [0xf800,0x07e0,0x001f,0xffff].forEach((c,i) => ext.mem.write16(source+i*2,c));
    const sp = stackTop()-32;
    [2,DRAW_BM_COPY,0,0,0,2].forEach((v,i) => ext.mem.write32(sp+i*4,v));
    redirect(); bridge.drawBitmapRop(sp,ext.mem,new Uint32Array([source,1,1,2]));
    expect([5,6,9,10].map(i=>ext.mem.read16(target+i*2))).toEqual([0xf800,0x07e0,0x001f,0xffff]);
    expect(bridge.screen.pixels.every(p => p === 0)).toBe(true);
    restore(); [4,DRAW_BM_COPY,0,0,0,4].forEach((v,i)=>ext.mem.write32(sp+i*4,v));
    bridge.drawBitmapRop(sp,ext.mem,new Uint32Array([target,0,0,4]));
    expect([241,242,481,482].map(i=>bridge.screen.pixels[i])).toEqual([0xf800,0x07e0,0x001f,0xffff]);
  });
  it("does not mirror a screen-sized affine destination into the LCD", () => {
    const { ext, bridge } = setup(), source = ext.alloc(8), target = ext.alloc(240*320*2);
    for(let i=0;i<4;i++) ext.mem.write16(source+i*2,0xf800);
    const src=ext.alloc(12),dst=ext.alloc(12),matrix=ext.alloc(12);
    for(const [desc,p,w,h] of [[src,source,2,2],[dst,target,240,320]]) {
      ext.mem.write32(desc,p);ext.mem.write16(desc+4,w);ext.mem.write16(desc+6,h);ext.mem.write16(desc+8,0);ext.mem.write16(desc+10,0);
    }
    [256,0,0,256,DRAW_BM_COPY].forEach((v,i)=>ext.mem.write16(matrix+i*2,v));
    bridge.drawBitmapEx(0,ext.mem,new Uint32Array([src,dst,2,2,matrix,0]));
    expect(ext.mem.read16(target)).toBe(0xf800); expect(bridge.screen.pixels.every(p=>p===0)).toBe(true);
  });
});
