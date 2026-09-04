# Stage 5-C.1 real-binary tests

These tests exercise inspection, optional trace, and the compatibility gate.

They use **synthetic** MRP/Lua only. They are **not** real-app tests.

`test/fixtures/real/app.mrp` is a user-supplied unprotected MRP. Gate on that file is **INSPECTED**, not real-app green. `runCompatibilityGate()` with no bytes is still `REAL_BINARY_BLOCKED`.

`loader-abi.test.ts` is the real-app chain: `start.mr` → `mrc_loader.ext` → `cfunction.ext` load → `arm_ext_call(6)` guest return 0, then stop at `table[17]`.

`cfunction-init.test.ts` is the isolated cfunction load: BLX → table[25] → table[14] memset zeros ER_RW.

`code6.test.ts` is forensics only (no host code-6 helper).

`testcom-130.test.ts` is table[130] / `asm_mr_TestCom` call-site forensics. Case 7 is implemented in 5-C.10B.

`testcom-130-abi.test.ts` is Stage 5-C.10B isolated ABI: case 7 only.

`testcom-130-dep.test.ts` is Stage 5-C.7 return-value / `ER_RW+0x1c` dependence.

`code0-chain.test.ts` is Stage 5-C.8：`0x01ea7f68` → table[14] → table[38] platEx → table[33] STOP.

`platex-38.test.ts` is Stage 5-C.9：table[38] 6-arg ABI / return unused / next slot 33. Handler for 0x4c6 is now present.

`platex-38-abi.test.ts` is Stage 5-C.10C isolated ABI: platEx code 0x4c6 only.

`real-mrp-startup.test.ts` is Stage 5-C.10E：真实 `app.mrp` 生产启动。table[33] `mr_getTime` REAL_EXECUTED，停在 table[17] `sprintf_`。No forensic bypass.

`gettime-33-forensics.test.ts` is Stage 5-C.10D：table[33] / `asm_mr_getTime` 调用点取证。Handler 现已注册。

`gettime-33-abi.test.ts` is Stage 5-C.10E isolated ABI: `runtime.clock >>> 0` / uint32 wrap / advance / zero-arg.

`sprintf-17-forensics.test.ts` is Stage 5-C.10F：table[17] / `sprintf_` 调用点与 vararg ABI 取证。Handler **未**注册。
