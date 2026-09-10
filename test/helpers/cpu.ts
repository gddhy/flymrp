import { ARMCPU } from "../../src/hot/cpu.ts";
import { GuestMemory } from "../../src/hot/memory.ts";
import { step } from "../../src/hot/interp.ts";

export function makeCpu(pc = 0x1000, thumb = 0): { cpu: ARMCPU; mem: GuestMemory } {
  const mem = new GuestMemory(0, 0x1_0000);
  const cpu = new ARMCPU(mem);
  cpu.reset(pc, thumb);
  return { cpu, mem };
}

export function putArm(mem: GuestMemory, pc: number, words: number[]): void {
  for (let i = 0; i < words.length; i++) {
    mem.write32(pc + i * 4, words[i]!);
  }
}

export function putThumb(mem: GuestMemory, pc: number, halfs: number[]): void {
  for (let i = 0; i < halfs.length; i++) {
    mem.write16(pc + i * 2, halfs[i]!);
  }
}

export function stepN(cpu: ARMCPU, n: number): void {
  for (let i = 0; i < n; i++) step(cpu);
}

export function flags(cpu: ARMCPU): { n: number; z: number; c: number; v: number; t: number } {
  return { n: cpu.n, z: cpu.z, c: cpu.c, v: cpu.v, t: cpu.t };
}
