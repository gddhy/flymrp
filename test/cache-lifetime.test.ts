import { expect, it } from "vitest";
import { BlockCache } from "../src/hot/cache.ts";
import { run } from "../src/hot/interp.ts";
import { makeCpu, putArm } from "./helpers/cpu.ts";

it("keeps decoding cache useful after more than 4096 distinct blocks", () => {
  const {cpu,mem}=makeCpu(0x1000,0),cache=new BlockCache();cache.addRegion(0x1000,5000*8);cpu.cache=cache;
  for(let i=0;i<5000;i++)putArm(mem,0x1000+i*8,[0xe3a00000|(i&255),0xe12fff1e]);
  for(let i=0;i<5000;i++){cpu.r[15]=0x1000+i*8;run(cpu,1);expect(cpu.r[0]).toBe(i&255);}
  const misses=cache.misses;
  for(let i=0;i<100;i++){cpu.r[15]=0x1000+4999*8;run(cpu,1);}
  expect(cache.misses).toBe(misses);expect(cache.pool.length).toBeLessThanOrEqual(4096);
});

it("invalidates an interior instruction while keeping unrelated blocks and recycling storage", () => {
  const {cpu,mem}=makeCpu(0x1000,0),cache=new BlockCache();cache.addRegion(0x1000,0x2000);cpu.cache=cache;
  putArm(mem,0x1000,[0xe3a00001,0xe3a01002,0xe12fff1e]);
  mem.onWrite=(addr,size)=>cache.invalidate(addr,size);
  run(cpu,2);const id=cache.lookupId(0x1000,0);expect(id).toBeGreaterThan(0);
  mem.write32(0x2800,42);expect(cache.lookupId(0x1000,0)).toBe(id);
  for(let i=0;i<5000;i++){
    mem.write32(0x1004,0xe3a01000|(i&255));cpu.r[15]=0x1000;run(cpu,2);expect(cpu.r[1]).toBe(i&255);
  }
  expect(cache.pool.length).toBe(2);
});

it("stops an executing block when the guest rewrites its upcoming instruction", () => {
  const {cpu,mem}=makeCpu(0x1000,0),cache=new BlockCache();cache.addRegion(0x1000,0x1000);cpu.cache=cache;
  putArm(mem,0x1000,[0xe58f0000,0xe1a02002,0xe3a01001,0xe12fff1e]);
  cpu.r[0]=0xe3a01007;mem.onWrite=(addr,size)=>cache.invalidate(addr,size);
  run(cpu,3);expect(cpu.r[1]).toBe(7);
});
