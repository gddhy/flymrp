import { EXT_CODE_ADDR } from "../src/abi/layout.ts";
import { ExtRuntime } from "../src/abi/runtime.ts";
import { ARMCPU } from "../src/hot/cpu.ts";
import { BlockCache } from "../src/hot/cache.ts";
import { run, step } from "../src/hot/interp.ts";
import { GuestMemory } from "../src/hot/memory.ts";
import { armB, armBx, armDpImm, OP_ADD, OP_MOV } from "../test/helpers/asm.ts";
import {
  ARM_LOAD_HELPER_OFF,
  assembleArmHelperAt,
  buildArmLoadImage,
  buildArmTableCaller,
  wordsToBytes,
} from "../test/helpers/ext-asm.ts";

function bench(name: string, n: number, fn: () => void): void {
  fn();
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  const ips = n / (ms / 1000);
  console.log(
    `${name.padEnd(22)} ${n.toString().padStart(10)} insns  ${ms.toFixed(1).padStart(8)} ms  ${(ips / 1e6).toFixed(2)} Mips`,
  );
}

const mem = new GuestMemory(0, 0x1_0000);
const add = armDpImm(OP_ADD, 0, 0, 0, 1);
for (let a = 0x1000; a < 0x1100; a += 4) mem.write32(a, add);
mem.write32(0x1100, armB((-0x104) >> 2));

const cpu = new ARMCPU(mem);
const cache = new BlockCache();
cache.addRegion(0, 0x1_0000);

const N = 1_000_000;
bench("arm_add+cache", N, () => {
  cpu.reset(0x1000, 0);
  cpu.cache = cache;
  run(cpu, N);
});

bench("arm_add step", N, () => {
  cpu.reset(0x1000, 0);
  cpu.cache = null;
  for (let i = 0; i < N; i++) {
    if ((cpu.r[15] >>> 0) >= 0x1104) cpu.r[15] = 0x1000;
    step(cpu);
  }
});

function benchCalls(name: string, n: number, fn: () => void): number {
  fn();
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  const cps = n / (ms / 1000);
  console.log(
    `${name.padEnd(22)} ${n.toString().padStart(10)} calls  ${ms.toFixed(1).padStart(8)} ms  ${(cps / 1e3).toFixed(1)} kcalls/s`,
  );
  return ms;
}

const rt = new ExtRuntime();
const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
rt.load(
  buildArmLoadImage({
    dest: EXT_CODE_ADDR,
    helperWords: assembleArmHelperAt(helperAt, { ret0: 0x10, ret1: 0x11, ret6: 0x16, ret8: 0x18 }),
  }),
);

const CALLS = 20_000;
const tBridge0 = rt.bridgeCalls;
const directMs = benchCalls("ext_direct_call", CALLS, () => {
  for (let i = 0; i < CALLS; i++) rt.arm_ext_call(0);
});

rt.registerHandler(5, (_c, _m, a) => (a[0] + a[1]) >>> 0);
const tableDest = 0x01e9_0000;
rt.pokeCode(tableDest, buildArmTableCaller({ dest: tableDest, slot: 5, r0: 1, r1: 2 }));
const tableMs = benchCalls("ext_table_call", CALLS, () => {
  for (let i = 0; i < CALLS; i++) rt.runGuest(tableDest);
});

const hits0 = rt.cache.hits;
const miss0 = rt.cache.misses;
rt.pokeCode(0x01e9_1000, wordsToBytes([armDpImm(OP_MOV, 0, 0, 0, 1), armBx(14)]));
for (let i = 0; i < 1000; i++) rt.runGuest(0x01e9_1000);
const hits = rt.cache.hits - hits0;
const miss = rt.cache.misses - miss0;
const hitRate = hits + miss ? ((100 * hits) / (hits + miss)).toFixed(1) : "n/a";
console.log(
  `${"ext_cache_hit_rate".padEnd(22)} ${String(hits).padStart(10)} hits   ${String(miss).padStart(8)} miss  ${hitRate}%`,
);

const tLoad = 200;
const img = buildArmLoadImage({
  dest: EXT_CODE_ADDR,
  helperWords: assembleArmHelperAt(helperAt, { ret0: 0x10 }),
});
benchCalls("ext_code_load", tLoad, () => {
  for (let i = 0; i < tLoad; i++) {
    rt.pokeCode(EXT_CODE_ADDR, img);
  }
});

const nestRt = new ExtRuntime();
const childDest = 0x0020_5000;
nestRt.load(
  buildArmLoadImage({
    dest: EXT_CODE_ADDR,
    helperWords: assembleArmHelperAt(EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF, {
      ret0: 0x20,
      ret6: 0x26,
      childLoad: childDest + 8,
    }),
  }),
);
nestRt.load(
  buildArmLoadImage({
    dest: childDest,
    helperWords: assembleArmHelperAt(childDest + ARM_LOAD_HELPER_OFF, { ret0: 0x30, ret6: 0x36 }),
  }),
  { dest: childDest, stage: true, runLoad: false },
);
const NEST = 2000;
benchCalls("ext_nested_call", NEST, () => {
  for (let i = 0; i < NEST; i++) nestRt.arm_ext_call(6);
});

const bridges = rt.bridgeCalls - tBridge0;
console.log(`${"ext_bridge_count".padEnd(22)} ${String(bridges).padStart(10)} table entries during benches`);
console.log(
  `${"ext_bridge_overhead".padEnd(22)} table ${(tableMs / CALLS * 1000).toFixed(2)} µs/call  direct ${(directMs / CALLS * 1000).toFixed(2)} µs/call`,
);

