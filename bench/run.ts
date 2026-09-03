import { EXT_CODE_ADDR } from "../src/abi/layout.ts";
import { ExtRuntime } from "../src/abi/runtime.ts";
import { ARMCPU } from "../src/hot/cpu.ts";
import { BlockCache } from "../src/hot/cache.ts";
import { run, step } from "../src/hot/interp.ts";
import { GuestMemory } from "../src/hot/memory.ts";
import {
  CREATE_ABC,
  CREATE_ABx,
  CREATE_AsBx,
  LuaVM,
  OP_ADD as OP_LADD,
  OP_CALL,
  OP_CLOSURE,
  OP_FORLOOP,
  OP_GETGLOBAL,
  OP_GETTABLE,
  OP_JMP,
  OP_LOADK,
  OP_MOVE,
  OP_NEWTABLE,
  OP_RETURN,
  OP_SETTABLE,
  OP_SUB,
  ColdConst,
  dumpChunk,
  proto,
} from "../src/lua/index.ts";
import { TAG_NUMBER, TAG_STRING } from "../src/lua/types.ts";
import { MRPArchive, buildMrp } from "../src/mrp/index.ts";
import { EV_KEY, MR_KEY_PRESS, MR_KEY_UP, MythroadRuntime } from "../src/mythroad/index.ts";
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

function kn(n: number): ColdConst { return { t: TAG_NUMBER, n }; }
function ks(s: string): ColdConst { return { t: TAG_STRING, s }; }

function benchLua(name: string, n: number, setup: () => LuaVM, once: (vm: LuaVM) => void): void {
  const vm = setup();
  once(vm);
  const t0 = performance.now();
  once(vm);
  const ms = performance.now() - t0;
  const ops = n / (ms / 1000);
  console.log(
    `${name.padEnd(22)} ${n.toString().padStart(10)} ops    ${ms.toFixed(1).padStart(8)} ms  ${(ops / 1e6).toFixed(2)} Mops/s  intern=${vm.L.stats.interns} tbl=${vm.L.stats.tables} cl=${vm.L.stats.closures}`,
  );
}

const arith = proto({
  maxstack: 8,
  k: [kn(1), kn(100000), kn(1), kn(0)],
  code: [
    CREATE_ABx(OP_LOADK, 0, 0),
    CREATE_ABx(OP_LOADK, 1, 1),
    CREATE_ABx(OP_LOADK, 2, 2),
    CREATE_ABx(OP_LOADK, 3, 3),
    CREATE_ABC(OP_SUB, 0, 0, 2),
    CREATE_AsBx(OP_JMP, 0, 1),
    CREATE_ABC(OP_LADD, 3, 3, 0),
    CREATE_AsBx(OP_FORLOOP, 0, -2),
    CREATE_ABC(OP_RETURN, 3, 2, 0),
  ],
});
const LOOP = 100_000;
benchLua("lua_arith_loop", LOOP, () => new LuaVM(), (vm) => {
  vm.L.insnCount = 0;
  vm.runCold(arith);
});

const CALLN = 50_000;
const child = proto({
  maxstack: 2,
  numparams: 1,
  k: [kn(1)],
  code: [CREATE_ABC(OP_LADD, 0, 0, 250), CREATE_ABC(OP_RETURN, 0, 2, 0)],
});
const callP = proto({
  maxstack: 10,
  p: [child],
  k: [kn(1), kn(CALLN), kn(0)],
  code: [
    CREATE_ABx(OP_CLOSURE, 6, 0),
    CREATE_ABx(OP_LOADK, 0, 0),
    CREATE_ABx(OP_LOADK, 1, 1),
    CREATE_ABx(OP_LOADK, 2, 0),
    CREATE_ABC(OP_SUB, 0, 0, 2),
    CREATE_AsBx(OP_JMP, 0, 3),
    CREATE_ABC(OP_MOVE, 3, 6, 0),
    CREATE_ABx(OP_LOADK, 4, 2),
    CREATE_ABC(OP_CALL, 3, 2, 2),
    CREATE_AsBx(OP_FORLOOP, 0, -4),
    CREATE_ABC(OP_RETURN, 3, 2, 0),
  ],
});
benchLua("lua_func_call", CALLN, () => new LuaVM(), (vm) => {
  vm.runCold(callP);
});

const TBLN = 50_000;
const tbl = proto({
  maxstack: 8,
  k: [kn(1), kn(TBLN), kn(9)],
  code: [
    CREATE_ABC(OP_NEWTABLE, 6, 0, 0),
    CREATE_ABx(OP_LOADK, 0, 0),
    CREATE_ABx(OP_LOADK, 1, 1),
    CREATE_ABx(OP_LOADK, 2, 0),
    CREATE_ABC(OP_SUB, 0, 0, 2),
    CREATE_AsBx(OP_JMP, 0, 2),
    CREATE_ABC(OP_SETTABLE, 6, 250, 252),
    CREATE_ABC(OP_GETTABLE, 3, 6, 250),
    CREATE_AsBx(OP_FORLOOP, 0, -3),
    CREATE_ABC(OP_RETURN, 3, 2, 0),
  ],
});
benchLua("lua_table_access", TBLN, () => new LuaVM(), (vm) => {
  vm.runCold(tbl);
});

{
  const vm = new LuaVM();
  vm.runCold(arith);
  vm.L.insnCount = 0;
  const t0 = performance.now();
  vm.runCold(arith);
  const ms = performance.now() - t0;
  const n = vm.L.insnCount;
  console.log(
    `${"lua_opcode_sec".padEnd(22)} ${n.toString().padStart(10)} ops    ${ms.toFixed(1).padStart(8)} ms  ${(n / (ms / 1000) / 1e6).toFixed(2)} Mops/s`,
  );
}

const pack = buildMrp([{ name: "start.mr", data: new Uint8Array(256).fill(7) }]);
const arc = MRPArchive.parse(pack);
const READN = 20_000;
{
  const t0 = performance.now();
  for (let i = 0; i < READN; i++) arc.readFile("start.mr");
  const ms = performance.now() - t0;
  console.log(
    `${"mrp_readFile".padEnd(22)} ${READN.toString().padStart(10)} reads  ${ms.toFixed(1).padStart(8)} ms  ${(READN / (ms / 1000) / 1e3).toFixed(1)} kreads/s`,
  );
}

{
  const N = 30_000;
  const vm = new LuaVM();
  vm.register("nop", () => 0);
  const p = proto({
    maxstack: 8,
    k: [ks("nop"), kn(1), kn(N)],
    code: [
      CREATE_ABx(OP_LOADK, 0, 1),
      CREATE_ABx(OP_LOADK, 1, 2),
      CREATE_ABx(OP_LOADK, 2, 1),
      CREATE_ABC(OP_SUB, 0, 0, 2),
      CREATE_AsBx(OP_JMP, 0, 2),
      CREATE_ABx(OP_GETGLOBAL, 3, 0),
      CREATE_ABC(OP_CALL, 3, 1, 1),
      CREATE_AsBx(OP_FORLOOP, 0, -3),
      CREATE_ABC(OP_RETURN, 0, 1, 0),
    ],
  });
  vm.runCold(p);
  const t0 = performance.now();
  vm.runCold(p);
  const ms = performance.now() - t0;
  console.log(
    `${"lua_native_call".padEnd(22)} ${N.toString().padStart(10)} calls  ${ms.toFixed(1).padStart(8)} ms  ${(ms / N * 1000).toFixed(2)} µs/call  intern=${vm.L.stats.interns} tbl=${vm.L.stats.tables} cl=${vm.L.stats.closures}`,
  );
}

{
  const helperAt = EXT_CODE_ADDR + ARM_LOAD_HELPER_OFF;
  const ext = buildArmLoadImage({
    dest: EXT_CODE_ADDR,
    helperWords: assembleArmHelperAt(helperAt, { ret0: 0x11 }),
  });
  const start = dumpChunk(
    proto({
      maxstack: 8,
      k: [ks("_strCom"), kn(601), ks("test.ext"), kn(800), kn(0), kn(801), ks("")],
      code: [
        CREATE_ABx(OP_GETGLOBAL, 0, 0),
        CREATE_ABx(OP_LOADK, 1, 1),
        CREATE_ABx(OP_LOADK, 2, 2),
        CREATE_ABC(OP_CALL, 0, 3, 2),
        CREATE_ABx(OP_GETGLOBAL, 1, 0),
        CREATE_ABx(OP_LOADK, 2, 3),
        CREATE_ABC(OP_MOVE, 3, 0, 0),
        CREATE_ABx(OP_LOADK, 4, 4),
        CREATE_ABC(OP_CALL, 1, 4, 2),
        CREATE_ABx(OP_GETGLOBAL, 2, 0),
        CREATE_ABx(OP_LOADK, 3, 5),
        CREATE_ABx(OP_LOADK, 4, 6),
        CREATE_ABx(OP_LOADK, 5, 4),
        CREATE_ABC(OP_CALL, 2, 4, 3),
        CREATE_ABC(OP_RETURN, 3, 2, 0),
      ],
    }),
  );
  const mrp = buildMrp([{ name: "start.mr", data: start }, { name: "test.ext", data: ext }]);
  const myth = new MythroadRuntime();
  myth.loadMrp(mrp);
  myth.start();
  const FULL = 200;
  {
    const t0 = performance.now();
    for (let i = 0; i < FULL; i++) myth.start();
    const ms = performance.now() - t0;
    console.log(
      `${"lua_ext_lua_full".padEnd(22)} ${FULL.toString().padStart(10)} calls  ${ms.toFixed(1).padStart(8)} ms  ${(ms / FULL * 1000).toFixed(2)} µs/call`,
    );
  }
  const call801 = proto({
    maxstack: 8,
    k: [ks("_strCom"), kn(801), ks(""), kn(0)],
    code: [
      CREATE_ABx(OP_GETGLOBAL, 0, 0),
      CREATE_ABx(OP_LOADK, 1, 1),
      CREATE_ABx(OP_LOADK, 2, 2),
      CREATE_ABx(OP_LOADK, 3, 3),
      CREATE_ABC(OP_CALL, 0, 4, 3),
      CREATE_ABC(OP_RETURN, 1, 2, 0),
    ],
  });
  myth.lua.runCold(call801);
  const N = 2_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) myth.lua.runCold(call801);
  const ms = performance.now() - t0;
  console.log(
    `${"lua_ext_lua".padEnd(22)} ${N.toString().padStart(10)} calls  ${ms.toFixed(1).padStart(8)} ms  ${(ms / N * 1000).toFixed(2)} µs/call`,
  );
}

{
  const rt = new MythroadRuntime();
  rt.state = 1;
  rt.lua.register("dealevent", () => 0);
  rt.lua.register("dealtimer", () => 0);
  const STEPN = 20_000;
  for (let i = 0; i < 100; i++) {
    rt.queueEvent(EV_KEY, MR_KEY_PRESS, MR_KEY_UP, 0);
    rt.step();
  }
  const t0 = performance.now();
  for (let i = 0; i < STEPN; i++) {
    rt.queueEvent(EV_KEY, MR_KEY_PRESS, MR_KEY_UP, 0);
    rt.step();
  }
  const ms = performance.now() - t0;
  console.log(
    `${"runtime_step".padEnd(22)} ${STEPN.toString().padStart(10)} steps  ${ms.toFixed(1).padStart(8)} ms  ${(STEPN / (ms / 1000) / 1e3).toFixed(1)} ksteps/s`,
  );

  const t1 = performance.now();
  for (let i = 0; i < STEPN; i++) {
    rt.queueEvent(EV_KEY, MR_KEY_PRESS, MR_KEY_UP, 0);
    rt.dispatchEvent(rt.pollEvent()!);
  }
  const ms1 = performance.now() - t1;
  console.log(
    `${"event_dispatch".padEnd(22)} ${STEPN.toString().padStart(10)} ev     ${ms1.toFixed(1).padStart(8)} ms  ${(STEPN / (ms1 / 1000) / 1e3).toFixed(1)} kdisp/s`,
  );

  rt.timers.start(rt.clock, 0, "dealtimer", 1);
  const TMR = 10_000;
  const t2 = performance.now();
  for (let i = 0; i < TMR; i++) {
    rt.timers.start(rt.clock, 0, "dealtimer", 1);
    rt.advance(0);
    rt.step();
  }
  const ms2 = performance.now() - t2;
  console.log(
    `${"timer_callback".padEnd(22)} ${TMR.toString().padStart(10)} cb     ${ms2.toFixed(1).padStart(8)} ms  ${(TMR / (ms2 / 1000) / 1e3).toFixed(1)} kcb/s`,
  );

  const pack2 = buildMrp([{ name: "res.bin", data: new Uint8Array(64).fill(3) }]);
  rt.loadMrp(pack2);
  const RN = 20_000;
  const t3 = performance.now();
  for (let i = 0; i < RN; i++) rt.vfs.readFile("res.bin");
  const ms3 = performance.now() - t3;
  console.log(
    `${"vfs_readFile".padEnd(22)} ${RN.toString().padStart(10)} reads  ${ms3.toFixed(1).padStart(8)} ms  ${(RN / (ms3 / 1000) / 1e3).toFixed(1)} kreads/s`,
  );

  const sysP = proto({
    maxstack: 4,
    k: [ks("GetSysInfo")],
    code: [CREATE_ABx(OP_GETGLOBAL, 0, 0), CREATE_ABC(OP_CALL, 0, 1, 2), CREATE_ABC(OP_RETURN, 0, 1, 0)],
  });
  const SN = 10_000;
  rt.lua.runCold(sysP);
  const t4 = performance.now();
  for (let i = 0; i < SN; i++) rt.lua.runCold(sysP);
  const ms4 = performance.now() - t4;
  console.log(
    `${"native_GetSysInfo".padEnd(22)} ${SN.toString().padStart(10)} calls  ${ms4.toFixed(1).padStart(8)} ms  ${(ms4 / SN * 1000).toFixed(2)} µs/call`,
  );
}

