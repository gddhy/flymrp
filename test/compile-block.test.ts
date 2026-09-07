import { describe, it, expect } from 'vitest';
import { compileBlock } from '../src/hot/compile-block.ts';
import { BlockCache, type BasicBlock } from '../src/hot/cache.ts';
import { execPacked, run } from '../src/hot/interp.ts';
import { packW0, Op } from '../src/hot/opcodes.ts';
import { makeCpu, flags, putArm } from './helpers/cpu.ts';

function block(words: number[]): BasicBlock {
  return { guestPC: 0x1000, endPC: 0x1000 + words.length / 3 * 4, count: words.length / 3,
    packed: Uint32Array.from(words), thumb: 0, generation: 1, valid: true, region: null, runs: 32, compiled: null };
}
let seed = 938453;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
function compare(b: BasicBlock, init: (c: ReturnType<typeof makeCpu>) => void) {
  const ref = makeCpu(), fast = makeCpu(); init(ref);
  fast.cpu.r.set(ref.cpu.r); fast.cpu.cpsr = ref.cpu.cpsr; fast.mem.ram8.set(ref.mem.ram8);
  for (let i = 0; i < b.count; i++) { execPacked(ref.cpu, 0x1000 + i * 4, ...Array.from(b.packed.slice(i * 3, i * 3 + 3)) as [number, number, number]); ref.cpu.insnCount++; }
  compileBlock(b)(fast.cpu, b.count, b);
  expect(Array.from(fast.cpu.r)).toEqual(Array.from(ref.cpu.r));
  expect(flags(fast.cpu)).toEqual(flags(ref.cpu));
  expect(fast.cpu.insnCount).toBe(ref.cpu.insnCount);
  expect(Buffer.compare(fast.mem.ram8, ref.mem.ram8)).toBe(0);
}
describe('hot block specialization', () => {
  it('matches reference arithmetic, shifts, conditions and flags at integer boundaries', () => {
    const edges = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff];
    for (let op = 0; op <= Op.MVN; op++) for (let cond = 0; cond < 16; cond++) for (let kind = 0; kind < 5; kind++) {
      const rd = random() % 15, rn = random() % 15, rm = random() % 15;
      const words = [packW0(op, cond, rd, rn, rm, 0, 1, 0), kind ? random() & 4095 : random() & 31, kind];
      compare(block(words), ({cpu}) => {
        for (let i = 0; i < 15; i++) cpu.r[i] = i < edges.length ? edges[i] : random();
        cpu.cpsr = (random() & 0xf0000000) | 0x10;
      });
    }
  });
  it('matches loads and stores with alignment, sign extension and writeback', () => {
    for (let op = Op.LDR; op <= Op.LDRSH; op++) for (let aux = 0; aux < 32; aux += 4) for (let align = 0; align < 4; align++) {
      compare(block([packW0(op, 14, 2, 1, 0, 0, 0, aux), 16, 0]), ({cpu, mem}) => {
        mem.ram8.fill(0xc7); cpu.r[1] = 0x2000 + align; cpu.r[2] = 0xfedcba98;
      });
    }
  });
  it('stops at the instruction budget and preserves fault PC and count', () => {
    const b = block([packW0(Op.ADD,14,0,0,0,0,0,0),1,4, packW0(Op.LDR,14,1,2,0,0,0,8),0,0]);
    const {cpu} = makeCpu(); cpu.r[2] = 0x80000000;
    const compiled = compileBlock(b); compiled(cpu,1,b);
    expect(cpu.r[0]).toBe(1); expect(cpu.r[15]).toBe(0x1004); expect(cpu.insnCount).toBe(1);
    cpu.reset(0x1000,0); cpu.r[2] = 0x80000000;
    expect(() => compiled(cpu,2,b)).toThrow('fault'); expect(cpu.r[15]).toBe(0x1004); expect(cpu.insnCount).toBe(1);
  });
  it('invalidates a compiled block when a store rewrites its next instruction', () => {
    const {cpu, mem} = makeCpu(); const cache = new BlockCache(); cache.addRegion(0,0x10000); cpu.cache=cache;
    putArm(mem,0x1000,[0xe5810000,0xe3a02001,0xeafffffe]);
    const b = cache.getOrDecode(cpu); b.compiled=compileBlock(b); b.runs=32;
    mem.onWrite=(a,n)=>cache.invalidate(a,n); cpu.r[0]=0xe3a02007; cpu.r[1]=0x1004;
    run(cpu,2); expect(cpu.r[2]).toBe(7); expect(b.valid).toBe(false);
  });
});
