# Stage 5-C.1 real-binary tests

These tests exercise inspection, optional trace, and the compatibility gate.

They use **synthetic** MRP/Lua only. They are **not** real-app tests.

`test/fixtures/real/app.mrp` is a user-supplied unprotected MRP. Gate on that file is **INSPECTED**, not real-app green. `runCompatibilityGate()` with no bytes is still `REAL_BINARY_BLOCKED`.

`loader-abi.test.ts` is the real-app chain: `start.mr` → `mrc_loader.ext` → `cfunction.ext` load → `arm_ext_call(6)` guest return 0, then stop at table[30] after guest inflate.

`cfunction-init.test.ts` is the isolated cfunction load: BLX → table[25] → table[14] memset zeros ER_RW.

`code6.test.ts` is forensics only (no host code-6 helper).

`testcom-130.test.ts` is table[130] / `asm_mr_TestCom` call-site forensics. Case 7 is implemented in 5-C.10B.

`testcom-130-abi.test.ts` is Stage 5-C.10B isolated ABI: case 7 only.

`testcom-130-dep.test.ts` is Stage 5-C.7 return-value / `ER_RW+0x1c` dependence.

`code0-chain.test.ts` is Stage 5-C.8：`0x01ea7f68` → table[14] → table[38] platEx → table[33] STOP.

`platex-38.test.ts` is Stage 5-C.9：table[38] 6-arg ABI / return unused / next slot 33. Handler for 0x4c6 is now present.

`platex-38-abi.test.ts` is Stage 5-C.10C isolated ABI: platEx code 0x4c6 only.

`real-mrp-startup.test.ts` is Stage 5-C.10Q：真实 `app.mrp` 生产启动。guest inflate 完成，停在 table[30] `mr_getCharBitmap`。No forensic bypass。

`inflate-budget.test.ts` is Stage 5-C.10Q：1M forensic watchdog landmark + 2M/5M same next state。

`post-inflate-startup.test.ts` is Stage 5-C.10R：生产 watchdog 下 inflate 完成证据 + SHA-256 oracle + Stage 5-C completion gate。

`open-40-forensics.test.ts` is Stage 5-C.10H：table[40] / `mr_open` filename provenance。Handler 现已注册（5-C.10K）。LIVE R0 为 pack filename。

`file-chain-forensics.test.ts` is Stage 5-C.10J：`_mr_readFile` pack-file ABI 静态链与只读 handle 设计。5-C.10K 已实现 40/44/45/41。当前生产停在 table[30]。

`memcpy-3-forensics.test.ts` is Stage 5-C.10L：table[3] `memcpy2` LIVE 首笔 ABI 与 directory loop 后续 slot。5-C.10M 已实现 3/10；该取证仍锁第一笔 table[3]，当前生产停在 table[30]。

`free-1-forensics.test.ts` is Stage 5-C.10N：table[1] `mr_free` ownership / allocation header 只读取证。5-C.10O 已实现 registry-only table[1]；该取证仍锁第一笔 LIVE ABI。

`gettime-33-forensics.test.ts` is Stage 5-C.10D：table[33] / `asm_mr_getTime` 调用点取证。Handler 现已注册。

`gettime-33-abi.test.ts` is Stage 5-C.10E isolated ABI: `runtime.clock >>> 0` / uint32 wrap / advance / zero-arg.

`sprintf-17-forensics.test.ts` is Stage 5-C.10F：table[17] / `sprintf_` 调用点与 vararg ABI 取证。Handler 现已注册（5-C.10G `%d`）。

`sprintf-17-abi.test.ts` is Stage 5-C.10G isolated ABI: guest-aware literal+`%d` / int32 / unsupported specifier / GuestMemory fault.
